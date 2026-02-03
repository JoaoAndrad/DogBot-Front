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
      const eligibleVoters = [];

      // Add host
      const hostWhatsappId = jam.host?.whatsappId || jam.hostWhatsAppId;
      if (hostWhatsappId) {
        eligibleVoters.push(hostWhatsappId);
      }

      // Add active listeners
      if (jam.listeners && Array.isArray(jam.listeners)) {
        for (const listener of jam.listeners) {
          if (listener.isActive && listener.user?.whatsappId) {
            eligibleVoters.push(listener.user.whatsappId);
          }
        }
      }

      logger.info(
        `[Skip] Votantes elegíveis (${eligibleVoters.length}): ${eligibleVoters.join(", ")}`,
      );

      if (eligibleVoters.length < 2) {
        return reply(
          "⚠️ Não há votantes suficientes na jam para criar uma votação de skip.",
        );
      }

      // Create collaborative vote
      const castRes = await backendClient.sendToBackend(
        `/api/groups/votes`,
        {
          chatId,
          creatorUserId,
          trackId: jam.currentTrack,
          trackName: jam.currentTrackName || "música atual",
          voteType: "skip",
          eligibleVoters,
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

          // Ignorar voto se for do criador da votação
          if (voter === creatorWhatsAppId) {
            logger.debug(
              `[Skip] Voto do criador ignorado: ${voter} é o criador da votação`,
            );
            return;
          }

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
          if (updatedVote.status === "passed") {
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
      const pollId = await polls.createPoll(
        client,
        chatId,
        `Pular ${jam.currentTrackName || "música atual"}?`,
        ["Sim", "Não"],
        handleSkipVote,
      );

      logger.info(`[Skip] Poll criado: ${pollId}`);

      // Send context message
      await reply(
        `🎵 Votação iniciada para pular *${jam.currentTrackName || "música atual"}*\n\n` +
          `Votantes elegíveis: ${eligibleVoters.length} (host + ouvintes ativos)\n` +
          `Maioria necessária: ${Math.ceil(eligibleVoters.length * 0.5)} votos`,
      );

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
