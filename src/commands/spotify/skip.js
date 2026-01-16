const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const polls = require("../../components/poll");
const { sendTrackSticker } = require("../../utils/stickerHelper");

module.exports = {
  name: "skip",
  aliases: ["pular", "next"],
  description: "Votação colaborativa para pular música (grupos Spotify Jam)",

  async execute(ctx) {
    const { message, reply, client } = ctx;
    const msg = message;
    const chatId = msg.from;

    // Comando temporariamente desativado
    return reply("⚠️ O comando /skip está temporariamente desativado.");

    // Check if is group: either msg.isGroup or chatId ends with @g.us
    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));

    if (!isGroup) {
      return reply(
        "⚠️ Este comando só funciona em grupos onde pessoas estão ouvindo Spotify juntas."
      );
    }

    try {
      // Get user info
      const author = msg.author || msg.from;
      let userId = null;

      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          userId = contact.id._serialized;
        }
      } catch (err) {
        userId = author;
      }

      logger.info(`[Skip] Iniciando votação de skip no grupo ${chatId}`);

      // Get group members from WhatsApp
      const chat = await msg.getChat();
      const memberIds = chat.participants.map((p) => p.id._serialized);

      logger.info(`[Skip] 👥 Membros do grupo: ${memberIds.length}`);

      // Get active listeners in this group
      const listenersRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}/active-listeners`,
        { memberIds },
        "POST"
      );

      if (
        !listenersRes ||
        !listenersRes.listeners ||
        listenersRes.listeners.length === 0
      ) {
        logger.info(`[Skip] 🎵 Conectados ao Spotify: 0`);
        return reply(
          "⚠️ Nenhum usuário conectado ao Spotify está tocando música no momento neste grupo."
        );
      }

      const listeners = listenersRes.listeners;
      logger.info(`[Skip] 🎵 Conectados ao Spotify: ${listeners.length}`);

      // Check if initiator is listening
      const initiator = listeners.find(
        (l) => l.identifier === userId || l.userId === userId
      );

      if (!initiator) {
        return reply(
          "⚠️ Você precisa estar ouvindo música no Spotify para iniciar uma votação de skip."
        );
      }

      // Get the track being played
      const currentTrack = initiator.currentTrack;
      if (!currentTrack) {
        return reply("⚠️ Não consegui identificar a música atual.");
      }

      // Find all listeners playing the same track (Jam session)
      const jamListeners = listeners.filter(
        (l) =>
          l.currentTrack &&
          l.currentTrack.trackId === currentTrack.trackId &&
          l.currentTrack.contextId === currentTrack.contextId
      );

      if (jamListeners.length < 2) {
        return reply(
          "⚠️ Você parece ser o único ouvindo esta música. Votação de skip é para sessões colaborativas (Jam)."
        );
      }

      const targetUserIds = jamListeners.map((l) => l.userId);

      // Create vote in backend
      const voteRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}/vote`,
        {
          voteType: "skip",
          trackId: currentTrack.trackId,
          trackName: currentTrack.trackName,
          trackArtists: currentTrack.artists,
          initiatorUserId: initiator.userId,
          targetUserIds,
          threshold: 0.5, // 50% needed
        }
      );

      if (!voteRes || !voteRes.vote) {
        return reply("❌ Erro ao criar votação. Tente novamente.");
      }

      const vote = voteRes.vote;
      const stats = voteRes.stats;

      // Get initiator info (já definido anteriormente, apenas reusar)
      const initiatorName = initiator
        ? initiator.displayName || initiator.identifier
        : "Alguém";

      // Create poll (apenas título e opções)
      const pollTitle = `⏭️ Skip: ${currentTrack.trackName}\nDe: ${currentTrack.artists}`;
      const pollOptions = ["✅ Sim, pular", "❌ Não, continuar"];

      // Create poll with callback
      const pollResult = await polls.createPoll(
        client,
        chatId,
        pollTitle,
        pollOptions,
        {
          voteType: "skip",
          voteId: vote.id,
          groupId: chatId,
          onVote: async (voteData) => {
            await handleSkipVote(
              voteData,
              vote.id,
              client,
              chatId,
              userId,
              initiator.userId
            );
          },
        }
      );

      // Enviar mensagem de contexto separada com menções
      const otherListeners = jamListeners.filter(
        (l) => l.userId !== initiator.userId
      );

      let contextMessage = `${initiatorName} deseja pular a música\n`;
      const mentionsList = [];

      if (otherListeners.length > 0) {
        const mentions = otherListeners
          .map((l) => {
            const phoneNumber = l.identifier.split("@")[0];
            mentionsList.push(l.identifier);
            return `@${phoneNumber}`;
          })
          .join(" ");
        contextMessage += `\n${mentions}\n`;
      }

      contextMessage += `\nVotos: ${stats.votesFor}/${stats.totalEligible} (${stats.needed} necessários)`;

      await client.sendMessage(chatId, contextMessage, {
        mentions: mentionsList,
      });

      // Send track artwork as sticker
      await sendTrackSticker(client, chatId, currentTrack);

      if (pollResult && pollResult.msgId) {
        // Update vote with pollId
        await backendClient.sendToBackend(`/api/groups/votes/${vote.id}/cast`, {
          userId: initiator.userId,
          isFor: true,
          pollId: pollResult.msgId,
        });
      }

      logger.info(`[Skip] Poll criada para votação ${vote.id}`);
    } catch (err) {
      logger.error("[Skip] Erro:", err);
      return reply(
        "❌ Erro ao iniciar votação de skip. Tente novamente mais tarde."
      );
    }
  },
};

/**
 * Handle vote on skip poll
 */
async function handleSkipVote(
  voteData,
  collaborativeVoteId,
  client,
  chatId,
  creatorId
) {
  try {
    const voter = voteData.voter; // Já vem resolvido para @c.us pelo pollComponent
    const selectedOptions = voteData.selectedOptions || [];
    const selectedIndexes = voteData.selectedIndexes || [];

    // Ignorar voto se for do criador da votação
    if (voter === creatorId) {
      logger.debug(
        `[Skip] Voto do criador ignorado: ${voter} é o criador da votação`
      );
      return;
    }

    logger.debug(`[Skip] VoteData completo:`, voteData);
    logger.debug(
      `[Skip] SelectedIndexes:`,
      selectedIndexes,
      `Type: ${typeof selectedIndexes}`
    );

    // 0 = Sim, 1 = Não
    const isFor = selectedIndexes.includes(0);

    logger.info(
      `[Skip] Voto recebido: voter=${voter} isFor=${isFor} voteId=${collaborativeVoteId}`
    );

    // Get voter's userId by looking up in database
    const userRes = await backendClient.sendToBackend(
      `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
      null,
      "GET"
    );

    if (!userRes || !userRes.found) {
      logger.warn(`[Skip] Voter ${voter} não encontrado no banco`);
      await client.sendMessage(
        chatId,
        `⚠️ @${
          voter.split("@")[0]
        }, envie /cadastro no meu privado para criar sua conta.`,
        { mentions: [voter] }
      );
      return;
    }

    // Check if user has Spotify connected
    if (!userRes.hasSpotify) {
      logger.warn(`[Skip] Voter ${voter} não tem conta Spotify conectada`);
      await client.sendMessage(
        chatId,
        `⚠️ @${
          voter.split("@")[0]
        }, envie /conectar para vincular sua conta no Spotify.`,
        { mentions: [voter] }
      );
      return;
    }

    // Cast vote
    const castRes = await backendClient.sendToBackend(
      `/api/groups/votes/${collaborativeVoteId}/cast`,
      {
        userId: userRes.userId,
        isFor,
      }
    );

    logger.debug(`[Skip] Cast response:`, castRes);

    if (!castRes || !castRes.vote) {
      logger.error("[Skip] Erro ao registrar voto", {
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
      `[Skip] Voto registrado. Status: ${updatedVote.status}, Stats: ${stats.votesFor}/${stats.totalEligible}`
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
        { mentions: [voter] }
      );
    }

    // Check if resolved
    if (updatedVote.status === "passed") {
      // Execute skip via backend API
      // Sempre usar a conta Spotify do desenvolvedor (Developer Account)
      const skipRes = await backendClient.sendToBackend(
        "/api/spotify/skip",
        {}
      );

      if (skipRes && skipRes.success) {
        await client.sendMessage(
          chatId,
          `✅ Votação aprovada! Pulando música... (${stats.votesFor}/${stats.totalEligible} votos)`
        );
      } else {
        await client.sendMessage(
          chatId,
          `⚠️ Votação aprovada, mas erro ao executar skip: ${
            skipRes?.error || "Erro desconhecido"
          }`
        );
      }
    } else if (updatedVote.status === "failed") {
      await client.sendMessage(
        chatId,
        `❌ Votação rejeitada. A música continua tocando. (${stats.votesFor}/${stats.totalEligible} votos)`
      );
    }
  } catch (err) {
    logger.error("[Skip] handleSkipVote erro:", err);
  }
}
