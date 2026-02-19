const polls = require("../../components/poll");
const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

/**
 * Comando /contestar para iniciar votação de contestação de treino
 * Uso: /contestar @usuario
 */
module.exports = {
  name: "contestar",
  description: "Contestar treino de um usuário via votação",
  async execute(ctx) {
    try {
      const chat = ctx.message.getChat ? await ctx.message.getChat() : ctx.chat;

      // Só funciona em grupos
      if (!chat.isGroup) {
        await ctx.reply("❌ Esse comando só funciona em grupos!");
        return;
      }

      // Verificar se há menção
      const mentionedIds = ctx.message.mentionedIds || [];
      if (mentionedIds.length === 0) {
        await ctx.reply(
          "❌ Você precisa mencionar o usuário que deseja contestar!\n\nUso: /contestar @usuario",
        );
        return;
      }

      const targetUserId = mentionedIds[0];
      const chatId = chat.id._serialized;
      const contesterId = ctx.message.from || ctx.message.author;

      // Não pode contestar a si mesmo
      if (targetUserId === contesterId) {
        await ctx.reply("❌ Você não pode contestar seu próprio treino!");
        return;
      }

      // Resolver @lid para @c.us se necessário
      let targetNumber = targetUserId;
      if (targetUserId.includes("@lid")) {
        try {
          const contact = await ctx.client.getContactById(targetUserId);
          if (contact && contact.id && contact.id._serialized) {
            targetNumber = contact.id._serialized;
          }
        } catch (err) {
          logger.error(`[contestar] Erro ao resolver @lid: ${err.message}`);
        }
      }

      // Extrair apenas o número (sem @c.us)
      const targetUserNumber = targetNumber.replace(/@c\.us$/i, "");

      logger.info(
        `[contestar] Buscando último treino de ${targetUserNumber} no grupo ${chatId}`,
      );

      // Buscar último treino do usuário neste grupo
      const lastWorkout = await backendClient.sendToBackend(
        `/api/workouts/last-workout/${targetUserNumber}?chatId=${chatId}`,
        null,
        "GET",
      );

      if (!lastWorkout || !lastWorkout.id) {
        const contact = await ctx.client.getContactById(targetUserId);
        const userName = contact.pushname || contact.name || "este usuário";
        await ctx.reply(
          `❌ ${userName} ainda não registrou nenhum treino neste grupo.`,
        );
        return;
      }

      // Buscar informações do usuário mencionado
      const targetContact = await ctx.client.getContactById(targetUserId);
      const targetName =
        targetContact.pushname || targetContact.name || "Usuário";

      // Buscar informações do contestador
      const contesterContact = await ctx.client.getContactById(contesterId);
      const contesterName =
        contesterContact.pushname || contesterContact.name || "Alguém";

      // Formatar data do treino
      const workoutDate = lastWorkout.workout_date || "data desconhecida";

      logger.info(
        `[contestar] Último treino encontrado: ${lastWorkout.id} em ${workoutDate}`,
      );

      // Criar poll de contestação
      const pollTitle = `⚖️ Contestação de Treino`;
      const pollOptions = ["✅ Manter treino", "❌ Remover treino"];

      // Mensagem de contexto
      await ctx.reply(
        `⚖️ *CONTESTAÇÃO INICIADA*\n\n` +
          `${contesterName} está contestando o treino de *${targetName}*\n\n` +
          `📅 Data: ${workoutDate}\n` +
          `🗳️ Vote na enquete abaixo!\n\n` +
          `Se a maioria votar para remover, o treino será excluído.`,
      );

      // Criar poll
      const pollResult = await polls.createPoll(
        ctx.client,
        chatId,
        pollTitle,
        pollOptions,
        {
          metadata: {
            type: "workout_contest",
            workoutId: lastWorkout.id,
            targetUserId: targetUserNumber,
            contesterId: contesterId.replace(/@c\.us$/i, ""),
            targetName: targetName,
            workoutDate: workoutDate,
            chatId: chatId,
          },
          onVote: async (voteData) => {
            logger.info(`[contestar] Voto recebido:`, voteData);
          },
        },
      );

      if (!pollResult || !pollResult.msgId) {
        logger.error("[contestar] Falha ao criar poll de contestação");
        await ctx.reply("❌ Erro ao criar votação. Tente novamente.");
        return;
      }

      logger.info(
        `[contestar] Poll de contestação criada: ${pollResult.msgId}`,
      );

      // Agendar fechamento da votação após 10 minutos
      setTimeout(
        async () => {
          await processContestResult(pollResult.msgId, ctx.client);
        },
        10 * 60 * 1000,
      ); // 10 minutos
    } catch (err) {
      logger.error(
        `[contestar] Erro ao processar comando: ${err.message}`,
        err,
      );
      await ctx.reply("❌ Erro ao processar contestação. Tente novamente.");
    }
  },
};

/**
 * Processa o resultado da votação de contestação
 */
async function processContestResult(pollId, client) {
  try {
    logger.info(`[contestar] Processando resultado da votação: ${pollId}`);

    // Buscar poll do backend
    const pollState = await backendClient.sendToBackend(
      `/api/polls/${pollId}`,
      null,
      "GET",
    );

    if (!pollState || !pollState.poll) {
      logger.error(`[contestar] Poll não encontrada: ${pollId}`);
      return;
    }

    const poll = pollState.poll;
    const votes = pollState.votes || [];
    const metadata =
      typeof poll.metadata === "string"
        ? JSON.parse(poll.metadata)
        : poll.metadata;

    if (!metadata || metadata.type !== "workout_contest") {
      logger.warn(`[contestar] Poll ${pollId} não é de contestação`);
      return;
    }

    // Contar votos
    let keepVotes = 0;
    let removeVotes = 0;

    votes.forEach((vote) => {
      const selectedIndexes = vote.selected_indexes || [];
      if (selectedIndexes.includes(0)) {
        keepVotes++; // ✅ Manter treino
      } else if (selectedIndexes.includes(1)) {
        removeVotes++; // ❌ Remover treino
      }
    });

    const totalVotes = keepVotes + removeVotes;

    logger.info(
      `[contestar] Resultado: ${removeVotes} para remover, ${keepVotes} para manter (${totalVotes} total)`,
    );

    // Determinar resultado
    const shouldRemove = removeVotes > keepVotes;

    // Buscar chat para enviar resultado
    const chat = await client.getChatById(metadata.chatId);

    if (totalVotes === 0) {
      await chat.sendMessage(
        `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
          `Nenhum voto foi registrado.\n` +
          `O treino de *${metadata.targetName}* (${metadata.workoutDate}) foi *mantido* por falta de votos.`,
      );
      return;
    }

    if (shouldRemove) {
      // Remover treino
      logger.info(`[contestar] Removendo treino ${metadata.workoutId}`);

      try {
        await backendClient.sendToBackend(
          `/api/workouts/logs/${metadata.workoutId}`,
          null,
          "DELETE",
        );

        await chat.sendMessage(
          `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
            `📊 Resultado: ${removeVotes} votos para remover vs ${keepVotes} para manter\n\n` +
            `❌ O treino de *${metadata.targetName}* (${metadata.workoutDate}) foi *REMOVIDO* por decisão da maioria.`,
        );

        logger.info(
          `[contestar] Treino ${metadata.workoutId} removido com sucesso`,
        );

        // Atualizar ranking do grupo imediatamente
        const groupRankingService = require("../../services/groupRankingService");
        logger.info(
          `[contestar] Atualizando ranking do grupo ${metadata.chatId}...`,
        );
        await groupRankingService.updateGroupRanking(metadata.chatId);
        logger.info(`[contestar] Ranking atualizado com sucesso`);
      } catch (deleteErr) {
        logger.error(
          `[contestar] Erro ao remover treino: ${deleteErr.message}`,
        );
        await chat.sendMessage(
          `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
            `A maioria votou para remover (${removeVotes} vs ${keepVotes}), mas houve um erro ao processar a remoção.\n` +
            `Entre em contato com um administrador.`,
        );
      }
    } else {
      await chat.sendMessage(
        `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
          `📊 Resultado: ${removeVotes} votos para remover vs ${keepVotes} para manter\n\n` +
          `✅ O treino de *${metadata.targetName}* (${metadata.workoutDate}) foi *MANTIDO*.`,
      );
    }

    // Remover poll do banco
    await backendClient.sendToBackend(`/api/polls/${pollId}`, null, "DELETE");
  } catch (err) {
    logger.error(
      `[contestar] Erro ao processar resultado: ${err.message}`,
      err,
    );
  }
}
