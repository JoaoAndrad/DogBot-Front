const fetch = require("node-fetch");
const { DateTime } = require("luxon");
const { MessageMedia } = require("whatsapp-web.js");
const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const polls = require("../../components/poll");
const { sendTrackSticker } = require("../../utils/stickerHelper");
const { isFromApp, prefix } = require("./fromAppText");

const BACKEND_BASE = (
  process.env.BACKEND_URL || "http://localhost:8000"
).replace(/\/$/, "");

/**
 * Mesmo JID usado em spotifyMembers[].identifier — necessário para menção real no grupo
 * (comando simulado pelo *DogBubble* não tem getContact()).
 */
function jidForMentionInitiator(
  spotifyMembers,
  initiatorUserId,
  whatsappIdFallback,
) {
  const row = spotifyMembers.find((m) => m.userId === initiatorUserId);
  if (row && row.identifier) return String(row.identifier).trim();
  const raw = String(whatsappIdFallback || "").trim();
  if (!raw) return null;
  if (raw.includes("@")) return raw;
  return `${raw}@c.us`;
}

function atTextFromJid(jid) {
  if (!jid) return "?";
  return `@${jid.split("@")[0]}`;
}

function displayNameForUserId(spotifyMembers, userId) {
  if (!spotifyMembers || !userId) return null;
  const m = spotifyMembers.find((x) => x.userId === userId);
  if (!m) return null;
  return m.displayName || (m.identifier && m.identifier.split("@")[0]) || null;
}

module.exports = {
  name: "voto",
  aliases: ["votar", "vote"],
  description:
    "Votação colaborativa para adicionar música atual à playlist do grupo",

  async execute(ctx) {
    const { message, reply, client } = ctx;
    const msg = message;
    const fromApp = isFromApp(msg);
    const chatId = msg.from;

    // Check if is group: either msg.isGroup or chatId ends with @g.us
    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));

    if (!isGroup) {
      return reply(
        "⚠️ Este comando só funciona em grupos com playlist compartilhada.",
      );
    }

    try {
      // Get user WhatsApp identifier
      let whatsappId = null;
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          whatsappId = contact.id._serialized;
        }
      } catch (err) {
        whatsappId = msg.author || msg.from;
      }

      logger.info(`[Voto] Iniciando votação para adicionar no grupo ${chatId}`);

      // Get initiator user info first
      const initiatorLookup = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(whatsappId)}`,
        null,
        "GET",
      );

      if (!initiatorLookup || !initiatorLookup.found) {
        return reply(
          "⚠️ Você precisa ter uma conta cadastrada. Envie /cadastro no meu privado.",
        );
      }

      if (!initiatorLookup.hasSpotify) {
        return reply(
          "⚠️ Você precisa conectar sua conta do Spotify. Use /conectar.",
        );
      }

      const initiatorUserId = initiatorLookup.userId;

      // Try to get display name from backend, then from WhatsApp contact, then fallback to phone number
      let initiatorDisplayName = initiatorLookup.displayName;
      if (!initiatorDisplayName) {
        try {
          const contact = await msg.getContact();
          initiatorDisplayName =
            contact?.pushname || contact?.name || whatsappId.split("@")[0];
        } catch (err) {
          initiatorDisplayName = whatsappId.split("@")[0];
        }
      }

      logger.info(
        `[Voto] Iniciador: ${initiatorDisplayName} (${initiatorUserId})`,
      );

      // Check if group has a playlist
      const groupRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}`,
        null,
        "GET",
      );

      if (!groupRes || !groupRes.group || !groupRes.group.playlistId) {
        return reply(
          "⚠️ Este grupo não tem uma playlist configurada. Use /playlist para configurar.",
        );
      }

      const group = groupRes.group;

      // Get group members from WhatsApp
      const chat = await msg.getChat();
      const memberIds = chat.participants.map((p) => p.id._serialized);

      logger.info(`[Voto] 👥 Membros do grupo: ${memberIds.length}`);

      // Get active listeners to check if initiator is playing and get their current track
      const listenersRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}/active-listeners`,
        { memberIds },
        "POST",
      );

      const listeners = (listenersRes && listenersRes.listeners) || [];
      logger.info(`[Voto] 🎵 Usuários ouvindo música: ${listeners.length}`);

      // Find initiator in listeners by userId (backend should return userId in listener object)
      let initiatorTrack = null;
      for (const listener of listeners) {
        // Try to match by userId if available, otherwise fallback to identifier matching
        if (
          listener.userId === initiatorUserId ||
          listener.identifier === whatsappId
        ) {
          initiatorTrack = listener.currentTrack;
          break;
        }
      }

      if (!initiatorTrack) {
        logger.warn(
          `[Voto] Iniciador ${initiatorDisplayName} não está tocando música no momento`,
        );
        return reply(
          "⚠️ Você precisa estar ouvindo música no Spotify para iniciar uma votação.",
        );
      }

      // Resolve all group members to user records and filter those with Spotify connected
      let spotifyMembers = [];
      try {
        // Preserve original member id alongside lookup result to avoid index mismatch
        const lookupResults = await Promise.all(
          memberIds.map(async (id) => {
            try {
              const res = await backendClient.sendToBackend(
                `/api/users/lookup?identifier=${encodeURIComponent(id)}`,
                null,
                "GET",
              );
              return { id, res };
            } catch (err) {
              logger.warn(`[Voto] Falha lookup usuario ${id}: ${err.message}`);
              return { id, res: null };
            }
          }),
        );

        // Helpful debug: log small sample of memberIds and listener identifiers
        try {
          logger.debug(
            `[Voto] amostra memberIds: ${JSON.stringify(memberIds.slice(0, 5))}`,
          );
          if (listeners && listeners.length > 0) {
            logger.debug(
              `[Voto] amostra listeners: ${JSON.stringify(
                listeners.slice(0, 5).map((l) => l.identifier),
              )}`,
            );
          }
        } catch (e) {
          /* ignore logging errors */
        }

        spotifyMembers = (lookupResults || [])
          .filter(({ res }) => res && res.found && res.hasSpotify)
          .map(({ id, res }) => {
            const identifier = res.identifier || id;
            return {
              identifier,
              userId: res.userId,
              displayName: res.displayName || null,
            };
          });
      } catch (err) {
        logger.warn(
          `[Voto] Erro ao resolver membros com Spotify: ${err.message}`,
        );
        spotifyMembers = [];
      }

      logger.info(
        `[Voto] Usuários do grupo com Spotify conectado: ${spotifyMembers.length}`,
      );

      if (!spotifyMembers || spotifyMembers.length === 0) {
        return reply("⚠️ Nenhum usuário do grupo tem conta Spotify conectada.");
      }

      // Get the track being played by initiator
      const currentTrack = initiatorTrack;
      logger.debug(`[Voto] currentTrack:`, JSON.stringify(currentTrack));

      if (!currentTrack || !currentTrack.trackName) {
        logger.error(
          `[Voto] Track inválido. currentTrack: ${JSON.stringify(currentTrack)}`,
        );
        return reply("⚠️ Não consegui identificar a música atual.");
      }

      logger.info(
        `[Voto] Música: ${currentTrack.trackName} (${currentTrack.trackId})`,
      );

      // Check playlist for exact or similar tracks first
      let checkRes = null;
      try {
        checkRes = await backendClient.sendToBackend(
          `/api/groups/playlists/${encodeURIComponent(
            group.playlistId,
          )}/check-track?trackId=${encodeURIComponent(
            currentTrack.trackId,
          )}&trackName=${encodeURIComponent(currentTrack.trackName)}`,
          null,
          "GET",
        );
      } catch (err) {
        logger.warn(
          "[Voto] Falha ao checar playlist para duplicatas:",
          err.message,
        );
      }

      // If exact exists -> abort with message
      if (checkRes && checkRes.existsExact) {
        return reply("⚠️ Essa música já está na playlist.");
      }

      // If similar matches found -> ask initiator to confirm starting the vote
      const similarMatches = (checkRes && checkRes.similar) || [];

      if (similarMatches.length > 0) {
        // Show top similar match to the group before asking initiator to confirm
        try {
          const top = similarMatches[0];
          const artistsText =
            top && top.artists
              ? Array.isArray(top.artists)
                ? top.artists.map((a) => a.name || a).join(", ")
                : String(top.artists)
              : "";
          const infoMsg = `${prefix(fromApp)}Uma versão dessa música talvez já exista na playlist (Nome: ${
            top.name || ""
          } do artista: ${artistsText})`;
          await client.sendMessage(chatId, infoMsg);
        } catch (err) {
          logger.debug(
            "[Voto] Falha ao enviar mensagem de similaridade:",
            err.message,
          );
        }
        // Before creating a full group vote, ask the initiator for confirmation.
        // Only the initiator is allowed to vote on this confirmation poll.
        const confirmTitle = `${prefix(fromApp)}Confirma iniciar votação para adicionar:\n${currentTrack.trackName} — ${currentTrack.artists}`;
        const confirmOptions = ["✅ Sim", "❌ Não"];

        const confirmResult = await polls.createPoll(
          client,
          chatId,
          confirmTitle,
          confirmOptions,
          {
            // Keep context so onVote knows who to proceed for
            onVote: async (voteData) => {
              try {
                const voter = voteData.voter;
                // Lookup voter to get their userId
                const voterLookup = await backendClient.sendToBackend(
                  `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
                  null,
                  "GET",
                );

                // Only accept confirmation vote from initiator
                if (
                  !voterLookup ||
                  !voterLookup.found ||
                  voterLookup.userId !== initiatorUserId
                ) {
                  logger.debug(
                    `[Voto] Ignorando confirmação de ${voter}; apenas iniciador pode confirmar.`,
                  );
                  return;
                }

                // Normalize selected indexes
                let selected = voteData.selectedIndexes || [];
                if (!Array.isArray(selected))
                  selected = Object.values(selected);
                const confirmed = selected.includes(0);

                if (!confirmed) {
                  await client.sendMessage(
                    chatId,
                    `🚫 ${initiatorDisplayName} cancelou a votação.`,
                  );
                  return;
                }

                // Proceed to create the collaborative vote for the group (all listeners)
                await createGroupVote();
              } catch (err) {
                logger.error("[Voto] Erro no handler de confirmação:", err);
              }
            },
          },
        );

        // If confirmation poll wasn't created, abort
        if (!confirmResult || !confirmResult.msgId) {
          return reply("❌ Erro ao solicitar confirmação. Tente novamente.");
        }
        // otherwise wait for confirmation handler to call createGroupVote
      } else {
        // No similar matches — create group vote immediately
        await createGroupVote();
      }

      // helper to create the actual group vote (called only after initiator confirms)
      async function createGroupVote() {
        // All Spotify-connected users in the group can vote on the actual group poll
        const targetUserIds = spotifyMembers.map((m) => m.userId);

        // Create vote in backend
        const voteRes = await backendClient.sendToBackend(
          `/api/groups/${encodeURIComponent(chatId)}/vote`,
          {
            voteType: "add",
            trackId: currentTrack.trackId,
            trackName: currentTrack.trackName,
            trackArtists: currentTrack.artists,
            initiatorUserId,
            targetUserIds,
            threshold: 0.5, // 50% needed
          },
        );

        if (voteRes && voteRes.cooldown) {
          await client.sendMessage(
            chatId,
            voteRes.message ||
              "⏳ Aguarde alguns minutos para iniciar outra votação para esta faixa.",
          );
          return;
        }

        if (!voteRes || !voteRes.vote) {
          await client.sendMessage(
            chatId,
            "❌ Erro ao criar votação. Tente novamente.",
          );
          return;
        }

        // Agregação de votos anteriores já atingiu o limiar — adicionar sem nova enquete
        if (voteRes.immediateAdd) {
          await addPassedTrackToPlaylist({
            vote: voteRes.vote,
            stats: voteRes.stats,
            group,
            client,
            chatId,
            initiatorAccountId: initiatorLookup.spotifyAccount?.id,
            fromApp,
            spotifyMembers,
          });
          return;
        }

        // Guard: votação ativa recente (< janela no backend) para a mesma faixa
        if (voteRes.alreadyExists) {
          await client.sendMessage(
            chatId,
            `⚠️ Já existe uma votação ativa para *${currentTrack.trackName}*. Vote na enquete em aberto!`,
          );
          return;
        }

        const vote = voteRes.vote;
        const stats = voteRes.stats;

        // Get playlist name from relation or fetch from Spotify
        let playlistName = group.playlist?.name || null;

        if (group.playlistId && !playlistName) {
          try {
            const playlistRes = await backendClient.sendToBackend(
              `/api/groups/playlists/${encodeURIComponent(group.playlistId)}`,
              null,
              "GET",
            );
            if (playlistRes && playlistRes.name) {
              playlistName = playlistRes.name;
            }
          } catch (err) {
            logger.warn(
              `[Voto] Erro ao buscar nome da playlist: ${err.message}`,
            );
          }
        }

        // Create poll (apenas título e opções)
        const pollTitle = fromApp
          ? `🎵 Adicionar (*DogBubble*): ${currentTrack.trackName}\nDe: ${currentTrack.artists}`
          : `🎵 Adicionar: ${currentTrack.trackName}\nDe: ${currentTrack.artists}`;
        const pollOptions = ["✅ Sim, adicionar", "❌ Não"];

        // Create poll with callback
        const pollResult = await polls.createPoll(
          client,
          chatId,
          pollTitle,
          pollOptions,
          {
            voteType: "add",
            voteId: vote.id,
            groupId: chatId,
            onVote: async (voteData) => {
              await handleAddVote(
                voteData,
                vote.id,
                group,
                client,
                chatId,
                whatsappId,
                initiatorLookup.spotifyAccount?.id,
                spotifyMembers,
              );
            },
          },
        );

        // Enviar mensagem de contexto separada com menções (iniciador = mesmo esquema @ + mentions[] que os outros)
        const otherMembers = spotifyMembers.filter(
          (m) => m.userId !== initiatorUserId,
        );

        const initiatorJid = jidForMentionInitiator(
          spotifyMembers,
          initiatorUserId,
          whatsappId,
        );
        const initiatorAt = initiatorJid
          ? atTextFromJid(initiatorJid)
          : initiatorDisplayName;

        let contextMessage = prefix(fromApp);
        contextMessage += playlistName
          ? `${initiatorAt} deseja adicionar a música à playlist ${playlistName}\n`
          : `${initiatorAt} deseja adicionar a música à playlist\n`;
        const mentionsList = initiatorJid ? [initiatorJid] : [];

        if (otherMembers.length > 0) {
          const mentions = otherMembers
            .map((m) => {
              const phoneNumber = m.identifier.split("@")[0];
              if (m.identifier && m.identifier !== initiatorJid) {
                mentionsList.push(m.identifier);
              }
              return `@${phoneNumber}`;
            })
            .join(" ");
          contextMessage += `\n${mentions}\n`;
        }

        contextMessage += `\nVotos: ${stats.votesFor}/${stats.needed} (mínimo para aprovar)`;

        await client.sendMessage(chatId, contextMessage, {
          mentions: mentionsList,
        });

        // Send track artwork as sticker
        await sendTrackSticker(client, chatId, currentTrack);

        // Fetch and send preview audio (after sticker) using backend proxy
        try {
          const proxyUrl = `${BACKEND_BASE}/api/spotify/preview?trackId=${encodeURIComponent(
            currentTrack.trackId,
          )}`;
          logger.debug(`[Voto] fetching preview from: ${proxyUrl}`);
          const pres = await fetch(proxyUrl);
          logger.debug(`[Voto] preview fetch status: ${pres && pres.status}`);
          const contentType =
            (pres.headers && pres.headers.get
              ? pres.headers.get("content-type")
              : null) || "";
          if (pres && pres.ok && contentType.includes("audio")) {
            const arrayBuffer = await pres.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const base64 = buffer.toString("base64");
            const media = new MessageMedia("audio/mpeg", base64);
            await client.sendMessage(chatId, media, {
              caption: `▶️ Prévia — ${currentTrack.trackName}`,
            });
          } else {
            try {
              const body = await pres.json().catch(() => null);
              logger.debug("[Voto] preview not audio, body:", body);
            } catch (e) {
              logger.debug(
                "[Voto] preview non-audio response and failed to parse body",
              );
            }
          }
        } catch (err) {
          logger.warn(
            "[Voto] failed to fetch/send preview:",
            err && err.message,
          );
        }

        if (pollResult && pollResult.msgId) {
          // Update vote with pollId and record initiator's auto-vote
          await backendClient.sendToBackend(
            `/api/groups/votes/${vote.id}/cast`,
            {
              userId: initiatorUserId,
              isFor: true,
              pollId: pollResult.msgId,
            },
          );
        }

        logger.info(`[Voto] Poll criada para votação ${vote.id}`);
      }
    } catch (err) {
      logger.error("[Voto] Erro:", err);
      return reply("❌ Erro ao iniciar votação. Tente novamente mais tarde.");
    }
  },
};

/**
 * Adiciona faixa à playlist após votação passed (enquete ou immediateAdd no backend).
 */
async function addPassedTrackToPlaylist({
  vote,
  stats,
  group,
  client,
  chatId,
  initiatorAccountId,
  fromApp = false,
  spotifyMembers = [],
}) {
  const playlistSpotifyId = group.playlist?.spotifyId;

  if (!playlistSpotifyId) {
    await client.sendMessage(
      chatId,
      "⚠️ Votação aprovada, mas playlist não tem ID do Spotify configurado.",
    );
    return;
  }

  const accountId = initiatorAccountId || group.playlist?.accountId;

  if (!accountId) {
    await client.sendMessage(
      chatId,
      "⚠️ Votação aprovada, mas não há conta Spotify configurada para gerenciar a playlist.",
    );
    return;
  }

  // Verifica no instante da adição se a música já não foi adicionada à playlist
  // (durante as horas ou minutos que a votação permaneceu em aberto).
  if (group.playlistId) {
    try {
      const reCheck = await backendClient.sendToBackend(
        `/api/groups/playlists/${encodeURIComponent(
          group.playlistId,
        )}/check-track?trackId=${encodeURIComponent(
          vote.trackId,
        )}&trackName=${encodeURIComponent(vote.trackName)}`,
        null,
        "GET",
      );

      if (reCheck && reCheck.existsExact) {
        await client.sendMessage(
          chatId,
          `⚠️ Votação aprovada, mas a música *${vote.trackName}* já havia sido colocada na playlist nesse meio tempo!`,
        );
        return;
      }
    } catch (err) {
      logger.warn(
        `[Voto] Falha no cheque secundário ao adicionar música aprovada: ${err.message}`,
      );
    }
  }

  const addRes = await backendClient.sendToBackend(
    `/api/spotify/playlists/${playlistSpotifyId}/tracks`,
    {
      trackUri: vote.trackId,
      accountId,
    },
  );

  if (addRes.success) {
    const head = fromApp
      ? "✅ Música adicionada à playlist pelo *DogBubble*!"
      : "✅ Música adicionada à playlist!";
    const needed = stats.needed != null ? stats.needed : stats.totalEligible;
    const ratio = `${stats.votesFor}/${needed}`;
    let body = `${head} (${ratio} votos)\n\n🎵 ${vote.trackName}\n${vote.trackArtists || ""}`;
    const details = stats.votersForDetail;
    if (Array.isArray(details) && details.length > 0) {
      body += "\n\n*Quem votou a favor:*";
      for (const row of details) {
        const name =
          displayNameForUserId(spotifyMembers, row.userId) ||
          String(row.userId).slice(0, 8);
        let line = `\n• ${name}`;
        if (row.votedAt) {
          try {
            const dt = DateTime.fromISO(row.votedAt, { zone: "utc" }).setZone(
              "America/Sao_Paulo",
            );
            line += ` — ${dt.toFormat("dd/MM/yyyy HH:mm")}`;
            if (row.fromEarlierRound) line += " (outra ronda)";
          } catch (e) {
            line += ` — ${row.votedAt}`;
          }
        }
        body += line;
      }
    }
    await client.sendMessage(chatId, body);

    try {
      const playlistRes = await backendClient.sendToBackend(
        `/api/groups/playlists/${encodeURIComponent(playlistSpotifyId)}`,
        null,
        "GET",
      );

      if (playlistRes && playlistRes.images && playlistRes.images.length > 0) {
        const playlistSticker = {
          trackId: playlistSpotifyId,
          trackName: playlistRes.name || "Playlist",
          image: playlistRes.images[0].url,
        };
        await sendTrackSticker(client, chatId, playlistSticker);
      }
    } catch (err) {
      logger.warn(
        `[Voto] Erro ao enviar figurinha da playlist: ${err.message}`,
      );
    }
  } else {
    await client.sendMessage(
      chatId,
      `⚠️ Votação aprovada, mas erro ao adicionar à playlist: ${addRes.error}`,
    );
  }
}

/**
 * Handle vote on add-to-playlist poll
 */
async function handleAddVote(
  voteData,
  collaborativeVoteId,
  group,
  client,
  chatId,
  creatorId,
  initiatorAccountId,
  spotifyMembers,
) {
  try {
    const voter = voteData.voter; // Já vem resolvido para @c.us pelo pollComponent
    let selectedIndexes = voteData.selectedIndexes || [];

    // selectedIndexes pode vir como objeto {"0": 0} em vez de array [0]
    if (!Array.isArray(selectedIndexes)) {
      selectedIndexes = Object.values(selectedIndexes);
    }

    // Ignorar voto se for do criador da votação
    if (voter === creatorId) {
      logger.debug(
        `[Voto] Voto do criador ignorado: ${voter} é o criador da votação`,
      );
      return;
    }

    logger.debug(`[Voto] VoteData completo:`, voteData);
    logger.debug(
      `[Voto] SelectedIndexes:`,
      selectedIndexes,
      `Type: ${typeof selectedIndexes}`,
    );

    // 0 = Sim, 1 = Não
    const isFor = selectedIndexes.includes(0);

    logger.info(
      `[Voto] Voto recebido: voter=${voter} isFor=${isFor} voteId=${collaborativeVoteId}`,
    );

    // Get voter's userId by looking up in database
    const userRes = await backendClient.sendToBackend(
      `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
      null,
      "GET",
    );

    if (!userRes || !userRes.found) {
      logger.warn(`[Voto] Voter ${voter} não encontrado no banco`);
      await client.sendMessage(
        chatId,
        `⚠️ @${
          voter.split("@")[0]
        }, envie /cadastro no meu privado para criar sua conta.`,
        { mentions: [voter] },
      );
      return;
    }

    // Check if user has Spotify connected
    if (!userRes.hasSpotify) {
      logger.warn(`[Voto] Voter ${voter} não tem conta Spotify conectada`);
      await client.sendMessage(
        chatId,
        `⚠️ @${
          voter.split("@")[0]
        }, envie /conectar para vincular sua conta no Spotify.`,
        { mentions: [voter] },
      );
      return;
    }

    // Cast vote - include pollId for backend validation
    const pollId = voteData.messageId || voteData.poll?.id;

    const castRes = await backendClient.sendToBackend(
      `/api/groups/votes/${collaborativeVoteId}/cast`,
      {
        userId: userRes.userId,
        isFor,
        pollId,
      },
    );

    logger.debug(`[Voto] Cast response:`, castRes);

    if (!castRes || !castRes.vote) {
      logger.error("[Voto] Erro ao registrar voto", {
        castRes,
        userId: userRes.userId,
        isFor,
        voteId: collaborativeVoteId,
      });
      return;
    }

    const updatedVote = castRes.vote;
    const stats = castRes.stats;

    logger.info(
      `[Voto] Voto registrado. Status: ${updatedVote.status}, Stats: ${stats.votesFor}/${stats.needed}`,
    );

    // Se o voto já foi resolvido antes (por outro evento concorrente), não processar novamente
    if (castRes.alreadyResolved) {
      logger.debug(
        `[Voto] Voto ${collaborativeVoteId} já foi resolvido anteriormente, ignorando`,
      );
      return;
    }

    // Get voter info for mention
    const voterContact = await client.getContactById(voter);
    const voterName =
      voterContact?.pushname || voterContact?.name || voter.split("@")[0];

    // Enviar atualização sobre o voto (se ainda não passou nem falhou)
    if (updatedVote.status === "active") {
      const votesNeeded = stats.needed - stats.votesFor;

      await client.sendMessage(
        chatId,
        `@${voter.split("@")[0]} ${
          isFor ? "também votou para adicionar" : "votou contra adicionar"
        } ${updatedVote.trackName} na playlist, ainda ${
          votesNeeded === 1
            ? "precisa de 1 voto"
            : `precisam de ${votesNeeded} votos`
        }. Mais alguém?`,
        { mentions: [voter] },
      );
    }

    // Check if resolved
    if (updatedVote.status === "passed" && !castRes.alreadyResolved) {
      await addPassedTrackToPlaylist({
        vote: updatedVote,
        stats,
        group,
        client,
        chatId,
        initiatorAccountId,
        fromApp: false,
        spotifyMembers,
      });
    } else if (updatedVote.status === "failed") {
      await client.sendMessage(
        chatId,
        `❌ Votação rejeitada. Música não foi adicionada. (${stats.votesFor}/${stats.needed})`,
      );
    }
  } catch (err) {
    logger.error("[Voto] handleAddVote erro:", err);
  }
}
