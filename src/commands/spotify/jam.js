const backend = require("../../services/backendClient");
const logger = require("../../utils/logger");
const polls = require("../../components/poll");

/**
 * Resolve host name with WhatsApp fallback
 * @param {Object} jam - Jam object with host data
 * @param {Object} client - WhatsApp client instance
 * @returns {Promise<string>} Resolved host name
 */
function normalizeWaJidForMention(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.includes("@")) return s;
  return `${s}@c.us`;
}

async function resolveHostName(jam, client) {
  // Try database fields first
  let name = jam.host?.push_name || jam.host?.display_name;

  // If empty, try to fetch from WhatsApp
  if (!name && jam.host?.sender_number && client) {
    try {
      const whatsappId = jam.host.sender_number.includes("@")
        ? jam.host.sender_number
        : `${jam.host.sender_number}@c.us`;

      const contact = await client.getContactById(whatsappId);
      name = contact?.pushname || contact?.name;
    } catch (err) {
      // Silently fail and use fallback
    }
  }

  // Final fallbacks: phone number or "Anônimo"
  return name || jam.host?.sender_number || "Anônimo";
}

module.exports = {
  name: "jam",
  aliases: ["radio", "jam.criar"],
  description: "Cria ou entra em uma jam/rádio para ouvir música sincronizada",
  async execute(ctx) {
    const reply =
      typeof ctx.reply === "function" ? ctx.reply : (t) => console.log(t);

    // Get user ID
    let userId = null;
    try {
      const msg = ctx.message;
      if (msg && typeof msg.getContact === "function") {
        const contact = await msg.getContact();
        userId = contact.id._serialized || contact.id;
      } else {
        // Em grupos, `from` é o @g.us; o remetente está em `author` (também na simulação companion).
        userId = (msg && (msg.author || msg.from)) || ctx.sender || null;
      }
    } catch (err) {
      console.log("[jam] Failed to resolve contact:", err.message);
      userId =
        (ctx.message && (ctx.message.author || ctx.message.from)) ||
        ctx.sender ||
        null;
    }

    if (!userId) {
      await reply("❌ Não foi possível identificar seu usuário.");
      return;
    }

    try {
      // Resolve WhatsApp identifier to User UUID
      const userLookup = await backend.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(userId)}`,
        null,
        "GET",
      );

      if (!userLookup || !userLookup.found || !userLookup.userId) {
        await reply(
          "❌ Usuário não encontrado no sistema.\n\n" +
            "Você precisa estar registrado para usar jams.",
        );
        return;
      }

      // Use the actual User UUID from database
      const userUuid = userLookup.userId;

      // Check if user already has an active jam (as host or listener)
      const statusResult = await backend.sendToBackend(
        `/api/jam/user/${userUuid}/status`,
        null,
        "GET",
      );

      if (!statusResult.success) {
        await reply("❌ Erro ao verificar status da jam. Tente novamente.");
        return;
      }

      // User is already hosting
      if (statusResult.role === "host") {
        const jam = statusResult.jam;
        const listenerCount =
          (jam.listeners?.filter((l) => l.isActive)?.length || 0) + 1;

        // Resolve listener names with WhatsApp fallback
        const activeListeners = jam.listeners?.filter((l) => l.isActive) || [];
        const listenerNamesPromises = activeListeners
          .slice(0, 5)
          .map(async (l) => {
            let name = l.user.display_name || l.user.push_name;
            if (!name && l.user.sender_number && ctx.client) {
              try {
                const whatsappId = l.user.sender_number.includes("@")
                  ? l.user.sender_number
                  : `${l.user.sender_number}@c.us`;
                const contact = await ctx.client.getContactById(whatsappId);
                name = contact?.pushname || contact?.name;
              } catch (err) {
                // Silently fail
              }
            }
            return name || l.user.sender_number || "Anônimo";
          });

        const listenerNames = (await Promise.all(listenerNamesPromises)).join(
          ", ",
        );

        let msg = `🎵 *Você já está hospedando uma jam!*\n\n`;
        msg += `👥 Ouvintes: ${listenerCount}\n`;
        if (listenerNames) {
          msg += `${listenerNames}${listenerCount > 5 ? " e outros..." : ""}\n`;
        }

        // Show current track or "nothing playing"
        if (jam.currentTrackName) {
          msg += `\n🎶 Tocando agora: *${jam.currentTrackName}*\n`;
          if (jam.currentArtists) {
            msg += `👤 ${jam.currentArtists}\n`;
          }
        } else {
          msg += `\n⏸️ Nada tocando no momento\n`;
        }

        msg += `\nEnvie */sair* para encerrar a jam.`;

        await reply(msg);
        return;
      }

      // User is already listening to a jam
      if (statusResult.role === "listener") {
        const jam = statusResult.jam;
        const hostName = await resolveHostName(jam, ctx.client);

        let msg = `🎧 *Você já está ouvindo a jam de ${hostName}*\n\n`;

        // Show current track or "nothing playing"
        if (jam.currentTrackName) {
          msg += `🎶 Tocando: *${jam.currentTrackName}*\n`;
          if (jam.currentArtists) {
            msg += `👤 ${jam.currentArtists}\n`;
          }
        } else {
          msg += `⏸️ Nada tocando no momento\n`;
        }

        msg += `\nEnvie */sair* para sair da jam.`;

        await reply(msg);
        return;
      }

      // Get chat ID and check if it's a group
      const chatId = ctx.message?.from || null;
      const isGroup = chatId && chatId.includes("@g.us");

      // Check for active jams (filtered by chat if in group)
      const activeJamsResult = await backend.sendToBackend(
        `/api/jam/active${isGroup ? `?chatId=${chatId}` : ""}`,
        null,
        "GET",
      );

      if (!activeJamsResult.success) {
        await reply("❌ Erro ao buscar jams ativas. Tente novamente.");
        return;
      }

      let activeJams = activeJamsResult.jams || [];

      // Filter jams by group members if in a group
      if (isGroup && ctx.message?.getChat) {
        try {
          const chat = await ctx.message.getChat();
          const participants = chat.participants || [];

          // Get WhatsApp IDs and resolve to UUIDs
          const participantWhatsAppIds = participants.map(
            (p) => p.id._serialized,
          );
          const participantUuids = new Set();

          // Resolve each WhatsApp ID to UUID
          for (const whatsappId of participantWhatsAppIds) {
            try {
              const lookup = await backend.sendToBackend(
                `/api/users/lookup?identifier=${encodeURIComponent(whatsappId)}`,
                null,
                "GET",
              );
              if (lookup && lookup.found && lookup.userId) {
                participantUuids.add(lookup.userId);
              }
            } catch (err) {
              // Ignore individual lookup failures
            }
          }

          // Get all active jams (not filtered by chatId)
          const allJamsResult = await backend.sendToBackend(
            `/api/jam/active`,
            null,
            "GET",
          );

          if (allJamsResult.success && allJamsResult.jams) {
            // Filter jams where:
            // 1. Host is a member of this group OR
            // 2. Any listener is a member of this group OR
            // 3. Jam was created in this chat
            activeJams = allJamsResult.jams.filter((jam) => {
              // Check if host is in group
              if (participantUuids.has(jam.hostUserId)) return true;

              // Check if jam was created in this chat
              if (jam.chatId === chatId) return true;

              // Check if any listener is in group
              if (jam.listeners && jam.listeners.length > 0) {
                return jam.listeners.some(
                  (listener) =>
                    listener.isActive && participantUuids.has(listener.userId),
                );
              }

              return false;
            });
          }
        } catch (err) {
          console.log("[jam] Could not filter by group members:", err.message);
          // Continue with original jams
        }
      }

      // No active jams: ask confirmation via poll (only initiator can vote)
      // Skip poll if request came from the app
      if (activeJams.length === 0) {
        const chatId = ctx.message?.from || null;
        const hostWhatsAppId = userId; // original WhatsApp identifier (e.g., 5581...@c.us)

        if (ctx.message?.fromApp) {
          // User confirmed via app automatically - create jam via backend
          const createResult = await backend.sendToBackend(
            "/api/jam/create",
            { userId: userUuid, chatId },
            "POST",
          );

          if (!createResult.success) {
            if (createResult.error === "USER_ALREADY_HOSTING") {
              await reply("❌ Você já está hospedando uma jam ativa.");
              return;
            }
            await reply(
              `❌ Erro ao criar jam: ${createResult.error || createResult.message}`,
            );
            return;
          }

          const jam = createResult.jam;

          // Anúncio no grupo com menção ao host (reply() não suporta mentions)
          const hostJid = normalizeWaJidForMention(userId);
          const hostAt = hostJid ? `@${hostJid.split("@")[0]}` : "";

          let announce = `🎵 *Jam iniciada pelo *DogBubble*!* 🎵\n\n`;
          announce += hostAt
            ? `${hostAt} está transmitindo sua música.\n`
            : `O anfitrião está transmitindo sua música.\n`;
          announce += `Caso deseje participar, envie */jam* aqui para sincronizar.\n\n`;

          if (jam && jam.currentTrackName) {
            announce += `🎶 Tocando agora: *${jam.currentTrackName}*\n`;
            if (jam.currentArtists) announce += `👤 ${jam.currentArtists}\n`;
          } else {
            announce += hostAt
              ? `⚠️ ${hostAt} você está tocando nada no momento. Inicie uma música no Spotify para compartilhar!\n`
              : `⚠️ Você está tocando nada no momento. Inicie uma música no Spotify para compartilhar!\n`;
          }

          if (ctx.client && chatId) {
            await ctx.client.sendMessage(chatId, announce, {
              mentions: hostJid ? [hostJid] : [],
            });
          } else {
            await reply(announce);
          }
          return;
        }

        try {
          // Confirmation poll — only the initiator's vote will be considered
          const confirmRes = await polls.createPoll(
            ctx.client,
            chatId,
            "Tem certeza que deseja iniciar uma jam?",
            ["✅ Sim, iniciar", "❌ Não"],
            {
              onVote: async (voteData) => {
                try {
                  const voter = voteData.voter;
                  // Only the initiator may vote on this confirmation poll
                  if (voter !== hostWhatsAppId) {
                    // ignore other voters
                    return;
                  }

                  const selectedIndexRaw =
                    voteData.selectedIndexes && voteData.selectedIndexes[0];
                  const selectedNames = voteData.selectedNames || [];
                  const selectedIndex =
                    selectedIndexRaw != null ? Number(selectedIndexRaw) : null;

                  const nameChoice = (selectedNames && selectedNames[0]) || "";
                  const confirmedByName = /sim|iniciar|yes|confirm/i.test(
                    nameChoice,
                  );

                  if (!(selectedIndex === 0 || confirmedByName)) {
                    // User cancelled
                    await ctx.client.sendMessage(
                      chatId,
                      "Certo! Foi só um alarme falso então. 😉",
                    );
                    return;
                  }

                  // User confirmed — create jam via backend
                  const createResult = await backend.sendToBackend(
                    "/api/jam/create",
                    { userId: userUuid, chatId },
                    "POST",
                  );

                  if (!createResult.success) {
                    if (createResult.error === "USER_ALREADY_HOSTING") {
                      await ctx.client.sendMessage(
                        chatId,
                        "❌ Você já está hospedando uma jam ativa.",
                      );
                      return;
                    }
                    await ctx.client.sendMessage(
                      chatId,
                      `❌ Erro ao criar jam: ${createResult.message || createResult.error}`,
                    );
                    return;
                  }

                  const jam = createResult.jam;

                  // Announce jam created in chat
                  let announce = `🎵 *Jam criada com sucesso!*\n\n`;
                  announce += `Você está transmitindo sua música para outros usuários.\n`;
                  announce += `Outros podem digitar */jam* para entrar.\n\n`;
                  if (jam.currentTrackName) {
                    announce += `🎶 Tocando agora: *${jam.currentTrackName}*\n`;
                    if (jam.currentArtists)
                      announce += `👤 ${jam.currentArtists}\n`;
                  } else {
                    announce += `⚠️ Nenhuma música tocando no momento. Inicie uma música no Spotify!\n`;
                  }
                  announce += `\nEnvie */sair* a qualquer momento para encerrar a jam.`;

                  await ctx.client.sendMessage(chatId, announce);

                  // After creating, send invite poll to let others join
                  try {
                    const hostName = await resolveHostName(jam, ctx.client);
                    const inviteRes = await polls.createPoll(
                      ctx.client,
                      chatId,
                      `🎵 Jam de ${hostName} — Deseja entrar?`,
                      ["✅ Entrar", "❌ Ignorar"],
                      {
                        onVote: async (inviteVote) => {
                          try {
                            const voterId = inviteVote.voter;
                            // Ignore host's votes client-side
                            if (voterId === hostWhatsAppId) return;

                            // Only consider 'Entrar' (index 0)
                            const sel =
                              inviteVote.selectedIndexes &&
                              inviteVote.selectedIndexes[0];
                            if (sel !== 0) return;

                            // Resolve voter to user UUID via backend lookup
                            const lookup = await backend.sendToBackend(
                              `/api/users/lookup?identifier=${encodeURIComponent(voterId)}`,
                              null,
                              "GET",
                            );

                            if (!lookup || !lookup.found || !lookup.userId) {
                              // Notify voter they must be registered
                              await ctx.client.sendMessage(
                                voterId,
                                "❌ Você precisa estar registrado no sistema para entrar em jams.",
                              );
                              return;
                            }

                            const voterUuid = lookup.userId;

                            // Call join endpoint
                            const joinRes = await backend.sendToBackend(
                              `/api/jam/${jam.id}/join`,
                              { userId: voterUuid },
                              "POST",
                            );

                            if (!joinRes.success) {
                              if (joinRes.error === "NO_ACTIVE_DEVICE") {
                                await ctx.client.sendMessage(
                                  voterId,
                                  "⚠️ Não foi possível sincronizar, primeiro inicie o Spotify em qualquer dispositivo e tente novamente.",
                                );
                                return;
                              }
                              // Silently ignore if user is already in jam
                              if (
                                joinRes.error === "ALREADY_LISTENING" ||
                                joinRes.error === "USER_IS_HOST"
                              ) {
                                return;
                              }
                              await ctx.client.sendMessage(
                                voterId,
                                `❌ Erro ao entrar na jam: ${joinRes.message || joinRes.error}`,
                              );
                              return;
                            }

                            // Success — announce in GROUP that user joined
                            const joinedJam = joinRes.jam || jam;
                            const hostName = await resolveHostName(
                              joinedJam,
                              ctx.client,
                            );

                            // Get voter name for mention
                            let voterName = voterId.split("@")[0];
                            try {
                              const voterContact =
                                await ctx.client.getContactById(voterId);
                              voterName =
                                voterContact?.pushname ||
                                voterContact?.name ||
                                voterName;
                            } catch (err) {
                              // fallback
                            }

                            let announceMsg = `🎧 @${voterId.split("@")[0]} entrou na jam de *${hostName}*!\n\n`;
                            if (joinedJam.currentTrackName) {
                              announceMsg += `🎶 Tocando: *${joinedJam.currentTrackName}*\n`;
                              if (joinedJam.currentArtists)
                                announceMsg += `👤 ${joinedJam.currentArtists}\n`;
                            }
                            announceMsg += `\n💡 *Quer ouvir junto?* Envie */jam* e escolha a jam de ${hostName}!`;

                            await ctx.client.sendMessage(chatId, announceMsg, {
                              mentions: [voterId],
                            });
                          } catch (ivErr) {
                            console.error(
                              "[jam] invite onVote error:",
                              ivErr && ivErr.message,
                            );
                          }
                        },
                      },
                    );

                    logger.debug(
                      "Invite poll sent:",
                      inviteRes && inviteRes.msgId,
                    );
                  } catch (invErr) {
                    console.error(
                      "[jam] Failed to send invite poll:",
                      invErr && invErr.message,
                    );
                  }
                } catch (err) {
                  console.error(
                    "[jam] confirm onVote error:",
                    err && err.message,
                  );
                }
              },
            },
          );

          logger.debug(
            "Confirmation poll sent:",
            confirmRes && confirmRes.msgId,
          );
        } catch (err) {
          console.error(
            "[jam] Error creating confirmation poll:",
            err && err.message,
          );
          await reply(`❌ Erro ao processar o pedido: ${err.message}`);
        }

        return;
      }

      // There are active jams, show unified poll with all options
      // Build poll options: one for each active jam + create new option
      const pollOptions = [];
      const jamIdMap = {}; // Map option index to jam ID or "create"

      // Add option for each active jam (limit to 10 to not overflow poll)
      const maxJams = Math.min(activeJams.length, 10);

      // Resolve all host names first
      const hostNames = await Promise.all(
        activeJams
          .slice(0, maxJams)
          .map((jam) => resolveHostName(jam, ctx.client)),
      );

      for (let i = 0; i < maxJams; i++) {
        const jam = activeJams[i];
        const hostName = hostNames[i];
        const listenerCount =
          (jam.listeners?.filter((l) => l.isActive)?.length || 0) + 1;

        let optionText = `🎧 Entrar na jam de ${hostName}`;
        if (listenerCount > 0) {
          optionText += ` (${listenerCount} ${listenerCount === 1 ? "ouvinte" : "ouvintes"})`;
        }

        pollOptions.push(optionText);
        jamIdMap[i] = jam.id;
      }

      // Add "create new" option at the end
      pollOptions.push("🎵 Criar minha própria jam");
      jamIdMap[pollOptions.length - 1] = "create";

      // Build message with jam details
      let pollMessage = `🎵 *${activeJams.length === 1 ? "Há uma jam ativa!" : `Há ${activeJams.length} jams ativas!`}*\n\n`;

      for (let i = 0; i < maxJams; i++) {
        const jam = activeJams[i];
        const hostName = hostNames[i];
        const listenerCount =
          (jam.listeners?.filter((l) => l.isActive)?.length || 0) + 1;

        pollMessage += `🎙️ *${hostName}*\n`;
        pollMessage += `👥 ${listenerCount} ${listenerCount === 1 ? "ouvinte" : "ouvintes"}\n`;
        if (jam.currentTrackName) {
          pollMessage += `🎶 ${jam.currentTrackName}\n`;
          if (jam.currentArtists) {
            pollMessage += `👤 ${jam.currentArtists}\n`;
          }
        } else {
          pollMessage += `⏸️ Nada tocando no momento\n`;
        }
        pollMessage += `\n`;
      }

      if (activeJams.length > maxJams) {
        pollMessage += `_...e mais ${activeJams.length - maxJams} ${activeJams.length - maxJams === 1 ? "jam" : "jams"}_\n\n`;
      }

      pollMessage += `*O que você quer fazer?*`;

      // Create poll using helper and register onVote to handle join/create
      try {
        const createRes = await polls.createPoll(
          ctx.client,
          chatId,
          pollMessage,
          pollOptions,
          {
            onVote: async (voteData) => {
              try {
                const voter = voteData.voter;
                const selIdxRaw =
                  voteData.selectedIndexes && voteData.selectedIndexes[0];
                const selIdx = selIdxRaw != null ? Number(selIdxRaw) : null;
                const selName =
                  (voteData.selectedNames && voteData.selectedNames[0]) || "";

                // Determine selected index by name if index missing
                let chosenIndex = selIdx;
                if (chosenIndex == null && selName) {
                  const match = pollOptions.findIndex(
                    (o) => o === selName || o.includes(selName),
                  );
                  chosenIndex = match >= 0 ? match : null;
                }

                if (chosenIndex == null) return;

                const selectedJamId = jamIdMap[chosenIndex];

                // If user chose to create a new jam
                if (selectedJamId === "create") {
                  // Resolve voter to UUID
                  const lookup = await backend.sendToBackend(
                    `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
                    null,
                    "GET",
                  );

                  if (!lookup || !lookup.found || !lookup.userId) {
                    await ctx.client.sendMessage(
                      voter,
                      "❌ Você precisa estar registrado no sistema para criar ou entrar em jams.",
                    );
                    return;
                  }

                  const voterUuid = lookup.userId;
                  const createResult = await backend.sendToBackend(
                    "/api/jam/create",
                    { userId: voterUuid, chatId },
                    "POST",
                  );

                  if (!createResult.success) {
                    await ctx.client.sendMessage(
                      voter,
                      `❌ Erro ao criar jam: ${createResult.message || createResult.error}`,
                    );
                    return;
                  }

                  const jam = createResult.jam;

                  // Get voter contact for mention
                  let voterName = voter.split("@")[0];
                  try {
                    const voterContact = await ctx.client.getContactById(voter);
                    voterName =
                      voterContact?.pushname || voterContact?.name || voterName;
                  } catch (err) {
                    // fallback to phone number
                  }

                  // Announce jam created in GROUP (not private)
                  let msg = `🎵 *Jam criada!*\n\n`;
                  msg += `@${voter.split("@")[0]} está transmitindo sua música!\n\n`;
                  if (jam.currentTrackName) {
                    msg += `🎶 Tocando agora: *${jam.currentTrackName}*\n`;
                    if (jam.currentArtists) msg += `👤 ${jam.currentArtists}\n`;
                  } else {
                    msg += `⚠️ Nenhuma música tocando no momento.\n`;
                  }
                  msg += `\n💡 *Quer ouvir junto?* Envie */jam* e escolha a jam de ${voterName}!`;

                  await ctx.client.sendMessage(chatId, msg, {
                    mentions: [voter],
                  });

                  // Send invite poll
                  try {
                    const hostName = await resolveHostName(jam, ctx.client);
                    await polls.createPoll(
                      ctx.client,
                      chatId,
                      `🎵 Jam de ${hostName} — Deseja entrar?`,
                      ["✅ Entrar", "❌ Ignorar"],
                      {
                        onVote: async (inviteVote) => {
                          try {
                            const voterId = inviteVote.voter;
                            // Ignore creator's votes
                            if (voterId === voter) return;

                            // Only consider 'Entrar' (index 0)
                            const sel =
                              inviteVote.selectedIndexes &&
                              inviteVote.selectedIndexes[0];
                            if (sel !== 0) return;

                            // Resolve voter to UUID
                            const lookup = await backend.sendToBackend(
                              `/api/users/lookup?identifier=${encodeURIComponent(voterId)}`,
                              null,
                              "GET",
                            );

                            if (!lookup || !lookup.found || !lookup.userId) {
                              await ctx.client.sendMessage(
                                voterId,
                                "❌ Você precisa estar registrado no sistema para entrar em jams.",
                              );
                              return;
                            }

                            const voterUuid = lookup.userId;

                            // Join jam
                            const joinRes = await backend.sendToBackend(
                              `/api/jam/${jam.id}/join`,
                              { userId: voterUuid },
                              "POST",
                            );

                            if (!joinRes.success) {
                              if (joinRes.error === "NO_ACTIVE_DEVICE") {
                                await ctx.client.sendMessage(
                                  voterId,
                                  "⚠️ Não foi possível sincronizar, primeiro inicie o Spotify em qualquer dispositivo e tente novamente.",
                                );
                                return;
                              }
                              // Silently ignore if already in jam
                              if (
                                joinRes.error === "ALREADY_LISTENING" ||
                                joinRes.error === "USER_IS_HOST"
                              ) {
                                return;
                              }
                              await ctx.client.sendMessage(
                                voterId,
                                `❌ Erro ao entrar na jam: ${joinRes.message || joinRes.error}`,
                              );
                              return;
                            }

                            // Success - announce in group
                            const joinedJam = joinRes.jam || jam;
                            const hostName = await resolveHostName(
                              joinedJam,
                              ctx.client,
                            );

                            let voterDisplayName = voterId.split("@")[0];
                            try {
                              const voterContact =
                                await ctx.client.getContactById(voterId);
                              voterDisplayName =
                                voterContact?.pushname ||
                                voterContact?.name ||
                                voterDisplayName;
                            } catch (err) {
                              // fallback
                            }

                            let announceMsg = `🎧 @${voterId.split("@")[0]} entrou na jam de *${hostName}*!\n\n`;
                            if (joinedJam.currentTrackName) {
                              announceMsg += `🎶 Tocando: *${joinedJam.currentTrackName}*\n`;
                              if (joinedJam.currentArtists)
                                announceMsg += `👤 ${joinedJam.currentArtists}\n`;
                            }
                            announceMsg += `\n💡 *Quer ouvir junto?* Envie */jam* e escolha a jam de ${hostName}!`;

                            await ctx.client.sendMessage(chatId, announceMsg, {
                              mentions: [voterId],
                            });
                          } catch (err) {
                            console.error(
                              "[jam] invite vote error:",
                              err && err.message,
                            );
                          }
                        },
                      },
                    );
                  } catch (invErr) {
                    console.error(
                      "[jam] Failed to send invite poll:",
                      invErr && invErr.message,
                    );
                  }

                  return;
                }

                // Otherwise, join existing jam
                const joinRes = await (async () => {
                  // Resolve voter to UUID
                  const lookup = await backend.sendToBackend(
                    `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
                    null,
                    "GET",
                  );
                  if (!lookup || !lookup.found || !lookup.userId) {
                    await ctx.client.sendMessage(
                      voter,
                      "❌ Você precisa estar registrado no sistema para entrar em jams.",
                    );
                    return { success: false };
                  }
                  const voterUuid = lookup.userId;
                  return await backend.sendToBackend(
                    `/api/jam/${selectedJamId}/join`,
                    { userId: voterUuid },
                    "POST",
                  );
                })();

                if (!joinRes || !joinRes.success) {
                  if (joinRes && joinRes.error === "NO_ACTIVE_DEVICE") {
                    await ctx.client.sendMessage(
                      voter,
                      "⚠️ Não foi possível sincronizar — abra o Spotify em qualquer dispositivo e tente novamente.",
                    );
                    return;
                  }
                  // Generic failure
                  if (joinRes && joinRes.message) {
                    await ctx.client.sendMessage(
                      voter,
                      `❌ Erro ao entrar na jam: ${joinRes.message || joinRes.error}`,
                    );
                  }
                  return;
                }

                const joinedJam = joinRes.jam;
                const hostName = await resolveHostName(joinedJam, ctx.client);

                // Get voter contact for mention
                let voterName = voter.split("@")[0];
                try {
                  const voterContact = await ctx.client.getContactById(voter);
                  voterName =
                    voterContact?.pushname || voterContact?.name || voterName;
                } catch (err) {
                  // fallback
                }

                // Announce in GROUP that user joined
                let announceMsg = `🎧 @${voter.split("@")[0]} entrou na jam de *${hostName}*!\n\n`;
                if (joinedJam.currentTrackName) {
                  announceMsg += `🎶 Tocando: *${joinedJam.currentTrackName}*\n`;
                  if (joinedJam.currentArtists)
                    announceMsg += `👤 ${joinedJam.currentArtists}\n`;
                }
                announceMsg += `\n💡 *Quer ouvir junto?* Envie */jam* e escolha a jam de ${hostName}!`;

                await ctx.client.sendMessage(chatId, announceMsg, {
                  mentions: [voter],
                });
              } catch (cbErr) {
                console.error(
                  "[jam] unified poll onVote error:",
                  cbErr && cbErr.message,
                );
              }
            },
          },
        );
        logger.debug("Unified poll sent:", createRes && createRes.msgId);
      } catch (pollErr) {
        console.error(
          "[jam] Failed to send unified poll:",
          pollErr && pollErr.message,
        );
      }
    } catch (err) {
      console.error("[jam] Error:", err);
      await reply(`❌ Erro ao processar comando /jam: ${err.message}`);
    }
  },

  /**
   * Handle poll response for jam decision
   */
  async handlePollResponse(ctx, pollContext, selectedOption) {
    const reply =
      typeof ctx.reply === "function" ? ctx.reply : (t) => console.log(t);

    const { userId, jamIdMap } = pollContext;
    const selectedJamId = jamIdMap[selectedOption];

    // User chose to create new jam
    if (selectedJamId === "create") {
      // Create new jam
      try {
        const chatId = ctx.message?.from || null;
        const createResult = await backend.sendToBackend(
          "/api/jam/create",
          { userId, chatId },
          "POST",
        );

        if (!createResult.success) {
          await reply(
            `❌ Erro ao criar jam: ${createResult.message || createResult.error}`,
          );
          return;
        }

        const jam = createResult.jam;
        let msg = `🎵 *Jam criada com sucesso!*\n\n`;
        msg += `Você está transmitindo sua música para outros usuários.\n`;

        if (jam.currentTrackName) {
          msg += `🎶 Tocando agora: *${jam.currentTrackName}*\n`;
          if (jam.currentArtists) {
            msg += `👤 ${jam.currentArtists}\n`;
          }
        }

        msg += `\nEnvie */sair* para encerrar a jam.`;

        await reply(msg);
      } catch (err) {
        console.error("[jam] Error creating:", err);
        await reply(`❌ Erro ao criar jam: ${err.message}`);
      }
      return;
    }

    // User chose to join an existing jam
    try {
      const joinResult = await backend.sendToBackend(
        `/api/jam/${selectedJamId}/join`,
        { userId },
        "POST",
      );

      if (!joinResult.success) {
        if (joinResult.error === "NO_ACTIVE_DEVICE") {
          await reply(
            "❌ *Não foi possível sincronizar*\n\n" +
              "Você precisa ter o Spotify aberto em qualquer dispositivo para entrar na jam.\n\n" +
              "📱 Abra o Spotify e tente novamente.",
          );
          return;
        }
        await reply(
          `❌ Erro ao entrar na jam: ${joinResult.message || joinResult.error}`,
        );
        return;
      }

      const jam = joinResult.jam;
      const hostName = await resolveHostName(jam, ctx.client);

      let msg = `🎧 *Você entrou na jam de ${hostName}!*\n\n`;

      if (joinResult.synced) {
        msg += `✅ Sua música foi sincronizada\n`;
        if (jam.currentTrackName) {
          msg += `🎶 Tocando: *${jam.currentTrackName}*\n`;
          if (jam.currentArtists) {
            msg += `👤 ${jam.currentArtists}\n`;
          }
        }
      } else {
        msg += `⚠️ Não foi possível sincronizar automaticamente.\n`;
        msg += `Certifique-se de que o Spotify está aberto.\n`;
      }

      msg += `\nEnvie */sair* para sair da jam.`;

      await reply(msg);
    } catch (err) {
      console.error("[jam] Error joining:", err);
      await reply(`❌ Erro ao entrar na jam: ${err.message}`);
    }
  },
};
