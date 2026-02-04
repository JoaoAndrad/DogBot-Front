const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const polls = require("../../components/poll");
const { sendTrackSticker } = require("../../utils/stickerHelper");

module.exports = {
  name: "skip",
  description: "Votação colaborativa para pular a música atual na jam",

  async execute(ctx) {
    const { message, reply, client } = ctx;
    const msg = message;
    const chatId = msg.from;

    // Check if is group: either msg.isGroup or chatId ends with @g.us
    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));

    if (!isGroup) {
      return reply("⚠️ Este comando só funciona em grupos com jam ativa.");
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

      logger.info(`[Skip] Iniciando votação no grupo ${chatId}`);

      // Get initiator user info
      const userRes = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(whatsappId)}`,
        null,
        "GET",
      );

      if (!userRes || !userRes.found) {
        return reply(
          "⚠️ Você precisa ter uma conta cadastrada. Envie /cadastro no meu privado.",
        );
      }

      const creatorUserId = userRes.userId;
      const creatorWhatsAppId = whatsappId;

      // Check if user is in an active jam
      const jamStatusRes = await backendClient.sendToBackend(
        `/api/jam/user/${creatorUserId}/status`,
        null,
        "GET",
      );

      if (!jamStatusRes || !jamStatusRes.jam) {
        return reply(
          "⚠️ Você não está participando de nenhuma jam ativa. Use /jam para criar ou entrar em uma.",
        );
      }

      const jam = jamStatusRes.jam;
      const jamId = jam.id;

      logger.info(
        `[Skip] Jam encontrada: ${jamId}, track: ${jam.currentTrack}`,
      );

      // Build list of eligible voters (host + active listeners)
      // Store both UUIDs (for backend) and WhatsApp IDs (for display)
      const eligibleUserIds = []; // UUIDs for backend
      const eligibleWhatsAppIds = []; // WhatsApp IDs for logging

      // Add host
      const hostUserId = jam.host?.id;
      const hostWhatsappId = jam.host?.sender_number;
      if (hostUserId && hostWhatsappId) {
        eligibleUserIds.push(hostUserId);
        eligibleWhatsAppIds.push(hostWhatsappId);
      }

      // Add active listeners
      if (jam.listeners && Array.isArray(jam.listeners)) {
        for (const listener of jam.listeners) {
          if (
            listener.isActive &&
            listener.user?.id &&
            listener.user?.sender_number
          ) {
            eligibleUserIds.push(listener.user.id);
            eligibleWhatsAppIds.push(listener.user.sender_number);
          }
        }
      }

      logger.info(
        `[Skip] Votantes elegíveis (${eligibleUserIds.length}): ${eligibleWhatsAppIds.join(", ")}`,
      );

      if (eligibleUserIds.length < 2) {
        return reply(
          "⚠️ Não há votantes suficientes na jam para criar uma votação de skip.",
        );
      }

      // Create collaborative vote
      const castRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}/vote`,
        {
          voteType: "skip",
          trackId: jam.currentTrack,
          trackName: jam.currentTrackName || "música atual",
          trackArtists: jam.currentArtists || "",
          initiatorUserId: creatorUserId,
          targetUserIds: eligibleUserIds,
          threshold: 0.5,
        },
        "POST",
      );

      if (!castRes || !castRes.vote) {
        logger.error("[Skip] Erro ao criar votação colaborativa", castRes);
        return reply("❌ Erro ao criar votação de skip.");
      }

      const vote = castRes.vote;
      const collaborativeVoteId = vote.id;

      logger.info(`[Skip] Votação criada: ${collaborativeVoteId}`);

      // Create handler for vote updates with closure capturing context
      const handleSkipVote = async (voteData) => {
        try {
          const voter = voteData.voter; // Já vem resolvido para @c.us pelo pollComponent
          const selectedOptions = voteData.selectedOptions || [];
          const selectedIndexes = voteData.selectedIndexes || [];

          // 0 = Sim, 1 = Não
          const isFor = selectedIndexes.includes(0);

          logger.info(
            `[Skip] Voto recebido: voter=${voter} isFor=${isFor} voteId=${collaborativeVoteId}`,
          );

          // Get voter's userId by looking up in database
          const voterUserRes = await backendClient.sendToBackend(
            `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
            null,
            "GET",
          );

          if (!voterUserRes || !voterUserRes.found) {
            logger.warn(`[Skip] Voter ${voter} não encontrado no banco`);
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
          if (!voterUserRes.hasSpotify) {
            logger.warn(
              `[Skip] Voter ${voter} não tem conta Spotify conectada`,
            );
            await client.sendMessage(
              chatId,
              `⚠️ @${
                voter.split("@")[0]
              }, envie /conectar para vincular sua conta no Spotify.`,
              { mentions: [voter] },
            );
            return;
          }

          // Cast vote
          const voteCastRes = await backendClient.sendToBackend(
            `/api/groups/votes/${collaborativeVoteId}/cast`,
            {
              userId: voterUserRes.userId,
              isFor,
              pollId: voteData.messageId || voteData.poll?.id,
            },
            "POST",
          );

          logger.debug(`[Skip] Cast response:`, voteCastRes);

          if (!voteCastRes || !voteCastRes.vote) {
            logger.error("[Skip] Erro ao registrar voto", {
              voteCastRes,
              userId: voterUserRes.userId,
              isFor,
              voteId: collaborativeVoteId,
            });
            return;
          }

          const updatedVote = voteCastRes.vote;
          const stats = voteCastRes.stats;

          logger.info(
            `[Skip] Voto registrado. Status: ${updatedVote.status}, Stats: ${stats.votesFor}/${stats.totalEligible}`,
          );

          // Se o voto já foi resolvido antes (por outro evento concorrente), não processar novamente
          if (voteCastRes.alreadyResolved) {
            logger.debug(
              `[Skip] Votação ${collaborativeVoteId} já foi resolvida anteriormente, ignorando`,
            );
            return;
          }

          // Get voter info for mention
          const voterContact = await client.getContactById(voter);
          const voterName =
            voterContact?.pushname || voterContact?.name || voter.split("@")[0];

          // Enviar atualização sobre o voto (se ainda não passou nem falhou)
          if (updatedVote.status === "pending") {
            const votesNeeded = stats.needed - stats.votesFor;

            await client.sendMessage(
              chatId,
              `@${voter.split("@")[0]} ${
                isFor ? "também votou para pular" : "votou para continuar"
              } ${updatedVote.trackName}, ainda ${
                votesNeeded === 1
                  ? "precisa de 1 voto"
                  : `precisam de ${votesNeeded} votos`
              }. Mais alguém?`,
              { mentions: [voter] },
            );
          }

          // Check if resolved
          if (updatedVote.status === "passed" && !voteCastRes.alreadyResolved) {
            // Execute skip for this jam via backend
            if (!jamId) {
              logger.error("[Skip] jamId missing when trying to execute skip");
              await client.sendMessage(
                chatId,
                `⚠️ Votação aprovada, mas falha ao identificar a jam.`,
              );
              return;
            }

            const skipRes = await backendClient.sendToBackend(
              `/api/jam/${jamId}/skip`,
              { userId: creatorUserId },
              "POST",
            );

            if (skipRes && skipRes.success) {
              await client.sendMessage(
                chatId,
                `✅ Votação aprovada! Pulando música e sincronizando ouvintes... (${stats.votesFor}/${stats.totalEligible} votos)`,
              );
            } else {
              const errText =
                skipRes?.error || skipRes?.details || "Erro desconhecido";
              if (
                errText === "NO_ACTIVE_DEVICE" ||
                (skipRes && skipRes.error === "NO_ACTIVE_DEVICE")
              ) {
                await client.sendMessage(
                  chatId,
                  `⚠️ Votação aprovada, mas o host não possui um dispositivo Spotify ativo. Peça para ele abrir o Spotify.`,
                );
              } else {
                await client.sendMessage(
                  chatId,
                  `⚠️ Votação aprovada, mas erro ao executar skip: ${errText}`,
                );
              }
            }
          } else if (updatedVote.status === "failed") {
            await client.sendMessage(
              chatId,
              `❌ Votação rejeitada. A música continua tocando. (${stats.votesFor}/${stats.totalEligible} votos)`,
            );
          }
        } catch (err) {
          logger.error("[Skip] handleSkipVote erro:", err);
        }
      };

      // Create poll for voting
      const pollResult = await polls.createPoll(
        client,
        chatId,
        `Pular ${jam.currentTrackName || "música atual"}?`,
        ["Sim", "Não"],
        {
          voteType: "skip",
          voteId: collaborativeVoteId,
          groupId: chatId,
          onVote: handleSkipVote,
        },
      );

      logger.info(`[Skip] Poll criado: ${pollResult?.msgId || pollResult}`);

      // Register initiator's automatic YES vote
      if (pollResult && pollResult.msgId) {
        try {
          await backendClient.sendToBackend(
            `/api/groups/votes/${collaborativeVoteId}/cast`,
            {
              userId: creatorUserId,
              isFor: true,
              pollId: pollResult.msgId,
            },
            "POST",
          );
          logger.info(`[Skip] Voto automático do iniciador registrado`);
        } catch (err) {
          logger.warn(`[Skip] Erro ao registrar voto automático:`, err);
        }
      }

      // Get initiator display name
      let initiatorDisplayName = null;
      try {
        const contact = await client.getContactById(creatorWhatsAppId);
        initiatorDisplayName = contact?.pushname || contact?.name || null;
      } catch (err) {
        logger.debug(`[Skip] Erro ao obter nome do iniciador:`, err);
      }

      if (!initiatorDisplayName) {
        initiatorDisplayName = creatorWhatsAppId.split("@")[0];
      }

      // Build mentions list (all eligible voters except initiator)
      const mentionsList = [];
      const otherVoters = eligibleWhatsAppIds.filter(
        (num) => num !== creatorWhatsAppId.replace("@c.us", ""),
      );

      let contextMessage = `🎵 *${initiatorDisplayName}* iniciou votação para pular:\n*${jam.currentTrackName || "música atual"}*\n\n`;

      if (otherVoters.length > 0) {
        const mentions = otherVoters
          .map((num) => {
            const whatsappId = `${num}@c.us`;
            mentionsList.push(whatsappId);
            return `@${num}`;
          })
          .join(" ");
        contextMessage += `${mentions}\n\n`;
      }

      contextMessage += `Votantes elegíveis: ${eligibleUserIds.length} (host + ouvintes)\n`;
      // Se tem 2 pessoas, precisa dos 2 votos (100%)
      // Se tem 3+, precisa de maioria estrita (50% + 1)
      const votesNeeded =
        eligibleUserIds.length === 2
          ? 2
          : Math.floor(eligibleUserIds.length / 2) + 1;
      contextMessage += `Maioria necessária: ${votesNeeded} votos`;

      // Send context message with mentions
      await client.sendMessage(chatId, contextMessage, {
        mentions: mentionsList,
      });

      // Send track sticker if available
      try {
        if (jam.currentTrack) {
          await sendTrackSticker(client, chatId, jam.currentTrack);
        }
      } catch (err) {
        logger.warn("[Skip] Erro ao enviar sticker:", err.message);
      }
    } catch (err) {
      logger.error("[Skip] Erro ao processar comando:", err);
      return reply(
        "❌ Erro ao processar votação de skip: " +
          (err.message || "Erro desconhecido"),
      );
    }
  },
};
