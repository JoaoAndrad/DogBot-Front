const polls = require("../../components/poll");
const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

// In-memory contest votes tracking
const activeContests = new Map();

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

      // Resolver @lid para @c.us se necessário para o contestador
      let contesterNumber = contesterId;
      if (contesterId.includes("@lid")) {
        try {
          const contact = await ctx.client.getContactById(contesterId);
          if (contact && contact.id && contact.id._serialized) {
            contesterNumber = contact.id._serialized;
          }
        } catch (err) {
          logger.error(
            `[contestar] Erro ao resolver contestador @lid: ${err.message}`,
          );
        }
      }

      const contesterNumberClean = contesterNumber.replace(/@c\.us$/i, "");

      // Resolver @lid para @c.us se necessário para o alvo
      let targetNumber = targetUserId;
      if (targetUserId.includes("@lid")) {
        try {
          const contact = await ctx.client.getContactById(targetUserId);
          if (contact && contact.id && contact.id._serialized) {
            targetNumber = contact.id._serialized;
          }
        } catch (err) {
          logger.error(
            `[contestar] Erro ao resolver alvo @lid: ${err.message}`,
          );
        }
      }

      // Extrair apenas o número (sem @c.us)
      const targetUserNumber = targetNumber.replace(/@c\.us$/i, "");

      // Não pode contestar a si mesmo
      if (contesterNumberClean === targetUserNumber) {
        await ctx.reply("❌ Você não pode contestar seu próprio treino!");
        return;
      }

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
      const contesterContact = await ctx.client.getContactById(contesterNumber);
      const contesterName =
        contesterContact.pushname || contesterContact.name || "Alguém";

      // Formatar data do treino
      const workoutDate = lastWorkout.workout_date || "data desconhecida";

      logger.info(
        `[contestar] Último treino encontrado: ${lastWorkout.id} em ${workoutDate}`,
      );

      // Get group participants
      const participants = chat.participants || [];
      const memberIds = participants.map((p) => p.id._serialized);

      logger.info(`[contestar] 👥 Membros do grupo: ${memberIds.length}`);

      // Get bot ID
      const botId = ctx.client.info?.wid?._serialized;
      const botNumber = botId ? botId.replace(/@c\.us$/i, "") : null;

      // Extract group admin numbers (exclude bot, contestador, contestado)
      const adminNumbers = participants
        .filter(
          (p) => (p.isAdmin || p.isSuperAdmin) && p.id && p.id._serialized,
        )
        .map((p) => p.id._serialized.replace(/@c\.us$/i, ""))
        .filter(
          (n) =>
            n !== botNumber &&
            n !== contesterNumberClean &&
            n !== targetUserNumber,
        );

      logger.info(
        `[contestar] 👑 Admins elegíveis (decisão final): ${adminNumbers.length}`,
      );

      // Filter eligible voters (exclude contestador, contestado, and bot)
      const eligibleVoters = memberIds.filter((id) => {
        const cleanId = id.replace(/@c\.us$/i, "");
        return (
          cleanId !== contesterNumberClean &&
          cleanId !== targetUserNumber &&
          cleanId !== botNumber
        );
      });

      logger.info(
        `[contestar] 👥 Elegíveis para votar: ${eligibleVoters.length} (excluindo contestador, contestado e bot)`,
      );

      // Criar poll de contestação
      const pollTitle = `⚖️ Contestação de Treino`;
      const pollOptions = ["✅ Manter treino", "❌ Remover treino"];

      // Mensagem de contexto com menções
      const totalEligible = eligibleVoters.length + 1; // +1 para o contestador que já votou
      const needed = Math.ceil(totalEligible / 2);

      let contextMessage =
        `⚖️ *CONTESTAÇÃO INICIADA*\n\n` +
        `${contesterName} está contestando o treino de *${targetName}*\n\n` +
        `📅 Data: ${workoutDate}\n`;

      const mentionsList = [];
      if (eligibleVoters.length > 0) {
        const mentions = eligibleVoters
          .map((id) => {
            const phoneNumber = id.split("@")[0];
            mentionsList.push(id);
            return `@${phoneNumber}`;
          })
          .join(" ");
        contextMessage += `\n${mentions}\n`;
      }

      contextMessage +=
        `\n🗳️ Vote na enquete abaixo!\n` +
        `Votos: 1/${totalEligible} (${needed} necessários para decidir)\n\n` +
        `Se a maioria votar para remover, o treino será excluído.` +
        (adminNumbers.length > 0
          ? `\n\nℹ️ Se a maioria votar para remover e o admin ainda não tiver votado, o admin terá a palavra final.`
          : "");

      await ctx.client.sendMessage(chatId, contextMessage, {
        mentions: mentionsList,
      });

      // Criar poll com callback para processar votos em tempo real
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
            contesterId: contesterNumberClean,
            targetName: targetName,
            contesterName: contesterName,
            workoutDate: workoutDate,
            chatId: chatId,
            memberIds: memberIds,
            botNumber: botNumber,
            adminNumbers: adminNumbers,
          },
          onVote: async (voteData) => {
            await handleContestVote(
              voteData,
              ctx.client,
              chatId,
              lastWorkout.id,
              targetUserNumber,
              contesterNumberClean,
              targetName,
              contesterName,
              workoutDate,
              memberIds,
              botNumber,
            );
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

      // Inicializar tracking de votos
      activeContests.set(pollResult.msgId, {
        workoutId: lastWorkout.id,
        targetUserId: targetUserNumber,
        contesterId: contesterNumberClean,
        targetName: targetName,
        contesterName: contesterName,
        workoutDate: workoutDate,
        chatId: chatId,
        memberIds: memberIds,
        botNumber: botNumber,
        adminNumbers: adminNumbers,
        awaitingAdminDecision: false,
        votes: { keep: 0, remove: 1 }, // Contestador já vota para remover
        voters: new Set([contesterNumberClean]), // Marcar contestador como já votou
        resolved: false,
      });

      logger.info(
        `[contestar] Voto automático do contestador ${contesterName} registrado (remover)`,
      );
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
 * Handle vote on workout contest poll
 */
async function handleContestVote(
  voteData,
  client,
  chatId,
  workoutId,
  targetUserId,
  contesterId,
  targetName,
  contesterName,
  workoutDate,
  memberIds,
  botNumber,
) {
  try {
    const voter = voteData.voter; // Já vem resolvido para @c.us pelo pollComponent
    const pollId = voteData.messageId || voteData.poll?.id;

    // Extrair número sem @c.us
    const voterNumber = voter.replace(/@c\.us$/i, "");

    // Ignorar voto do bot
    if (botNumber && voterNumber === botNumber) {
      logger.debug(`[contestar] Voto do bot ignorado`);
      return;
    }

    // Ignorar voto do contestador (já contado automaticamente)
    if (voterNumber === contesterId) {
      logger.debug(
        `[contestar] Voto do contestador ${contesterId} ignorado (já contado automaticamente)`,
      );
      return;
    }

    // Ignorar voto do contestado
    if (voterNumber === targetUserId) {
      logger.debug(
        `[contestar] Voto do contestado ${targetUserId} ignorado (não pode votar em própria contestação)`,
      );
      return;
    }

    // Get contest data
    const contest = activeContests.get(pollId);

    if (!contest) {
      logger.warn(`[contestar] Contest não encontrado para poll ${pollId}`);
      return;
    }

    // Check if already resolved
    if (contest.resolved) {
      logger.debug(`[contestar] Contest ${pollId} já foi resolvido`);
      return;
    }

    // Admin final-say gate: when awaiting admin decision, only admins may vote
    if (contest.awaitingAdminDecision) {
      const isAdminVoter =
        contest.adminNumbers && contest.adminNumbers.includes(voterNumber);
      if (!isAdminVoter) {
        logger.debug(
          `[contestar] Aguardando decisão do admin — voto de ${voterNumber} ignorado`,
        );
        return;
      }
      // Admin is voting — fall through to register vote, then resolved via admin path below
      logger.info(`[contestar] 👑 Admin ${voterNumber} dando a palavra final`);
    }

    // Check if voter already voted
    if (contest.voters.has(voterNumber)) {
      logger.debug(`[contestar] ${voterNumber} já votou nesta contestação`);
      return;
    }

    let selectedIndexes = voteData.selectedIndexes || [];

    // selectedIndexes pode vir como objeto {"0": 0} em vez de array [0]
    if (!Array.isArray(selectedIndexes)) {
      selectedIndexes = Object.values(selectedIndexes);
    }

    // 0 = Manter, 1 = Remover
    const voteToRemove = selectedIndexes.includes(1);

    logger.info(
      `[contestar] Voto recebido: voter=${voterNumber} voteToRemove=${voteToRemove}`,
    );

    // Register vote
    contest.voters.add(voterNumber);
    if (voteToRemove) {
      contest.votes.remove++;
    } else {
      contest.votes.keep++;
    }

    // Admin final-say resolution: if this was the admin's deciding vote, resolve immediately
    if (contest.awaitingAdminDecision) {
      const adminContact = await client.getContactById(voter);
      const adminName =
        adminContact?.pushname || adminContact?.name || voterNumber;

      contest.resolved = true;

      if (voteToRemove) {
        try {
          await backendClient.sendToBackend(
            `/api/workouts/logs/${workoutId}`,
            null,
            "DELETE",
          );
          await client.sendMessage(
            chatId,
            `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
              `👑 *${adminName}* (admin) deu a palavra final: *REMOVER*\n\n` +
              `❌ O treino de *${targetName}* (${workoutDate}) foi *REMOVIDO*.`,
          );
          logger.info(
            `[contestar] Treino ${workoutId} removido por decisão do admin ${adminName}`,
          );
          const groupRankingService = require("../../services/groupRankingService");
          await groupRankingService.updateGroupRanking(chatId);
        } catch (deleteErr) {
          logger.error(
            `[contestar] Erro ao remover treino (decisão do admin): ${deleteErr.message}`,
          );
          await client.sendMessage(
            chatId,
            `⚖️ Admin decidiu remover, mas houve um erro ao processar. Contate um administrador.`,
          );
        }
      } else {
        await client.sendMessage(
          chatId,
          `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
            `👑 *${adminName}* (admin) deu a palavra final: *MANTER*\n\n` +
            `✅ O treino de *${targetName}* (${workoutDate}) foi *MANTIDO*.`,
        );
      }

      activeContests.delete(pollId);
      try {
        await backendClient.sendToBackend(
          `/api/polls/${pollId}`,
          null,
          "DELETE",
        );
      } catch (err) {
        logger.warn(`[contestar] Erro ao deletar poll: ${err.message}`);
      }
      return;
    }

    // Get voter info for mention
    const voterContact = await client.getContactById(voter);
    const voterName =
      voterContact?.pushname || voterContact?.name || voter.split("@")[0];

    // Calculate eligible voters (all members except contestador, targetUserId, and bot)
    const eligibleVoters = memberIds.filter((id) => {
      const cleanId = id.replace(/@c\.us$/i, "");
      return (
        cleanId !== contesterId &&
        cleanId !== targetUserId &&
        cleanId !== botNumber
      );
    });

    const totalEligible = eligibleVoters.length + 1; // +1 para incluir o contestador (que já votou)
    const totalVotes = contest.votes.keep + contest.votes.remove;
    const needed = Math.ceil(totalEligible / 2); // Maioria simples

    logger.info(
      `[contestar] Votos: ${contest.votes.remove} remover, ${contest.votes.keep} manter (${totalVotes}/${totalEligible}, ${needed} necessários)`,
    );

    // Check if resolved
    const removeWon = contest.votes.remove >= needed;
    const keepWon = contest.votes.keep >= needed;
    const allVoted = totalVotes >= totalEligible;

    if (!removeWon && !keepWon && !allVoted) {
      // Ainda pendente - apenas log
      const votesNeeded =
        needed - Math.max(contest.votes.remove, contest.votes.keep);

      logger.debug(
        `[contestar] ${voterName} ${
          voteToRemove ? "votou para remover" : "votou para manter"
        } o treino de ${targetName}. ${
          votesNeeded === 1
            ? "Ainda precisa de 1 voto"
            : `Ainda precisam de ${votesNeeded} votos`
        } para decidir.`,
      );
      return;
    }

    // If remove won, check if an admin still needs to give the final say
    if (removeWon && !contest.awaitingAdminDecision) {
      const anyAdminVoted =
        contest.adminNumbers.length === 0 ||
        contest.adminNumbers.some((n) => contest.voters.has(n));

      if (!anyAdminVoted) {
        // Pause voting — await admin's final decision
        contest.awaitingAdminDecision = true;
        const adminMentionsList = contest.adminNumbers.map((n) => `${n}@c.us`);
        const adminMentionsText = adminMentionsList
          .map((id) => `@${id.split("@")[0]}`)
          .join(" ");

        await client.sendMessage(
          chatId,
          `⚖️ *MAIORIA VOTOU PARA REMOVER*\n\n` +
            `📊 Placar: ${contest.votes.remove} remover vs ${contest.votes.keep} manter\n\n` +
            `👑 ${adminMentionsText}\n` +
            `A palavra final é do admin! Vote na enquete acima.\n\n` +
            `_(Outros votos não serão mais aceitos)_`,
          { mentions: adminMentionsList },
        );
        logger.info(
          `[contestar] Aguardando decisão do admin para remoção do treino ${workoutId}`,
        );
        return;
      }
    }

    // Mark as resolved
    contest.resolved = true;

    if (removeWon) {
      // Remover treino
      logger.info(`[contestar] Removendo treino ${workoutId}`);

      try {
        await backendClient.sendToBackend(
          `/api/workouts/logs/${workoutId}`,
          null,
          "DELETE",
        );

        await client.sendMessage(
          chatId,
          `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
            `📊 Resultado: ${contest.votes.remove} votos para remover vs ${contest.votes.keep} para manter\n\n` +
            `❌ O treino de *${targetName}* (${workoutDate}) foi *REMOVIDO* por decisão da maioria.`,
        );

        logger.info(`[contestar] Treino ${workoutId} removido com sucesso`);

        // Atualizar ranking do grupo imediatamente
        const groupRankingService = require("../../services/groupRankingService");
        logger.info(`[contestar] Atualizando ranking do grupo ${chatId}...`);
        await groupRankingService.updateGroupRanking(chatId);
        logger.info(`[contestar] Ranking atualizado com sucesso`);
      } catch (deleteErr) {
        logger.error(
          `[contestar] Erro ao remover treino: ${deleteErr.message}`,
        );
        await client.sendMessage(
          chatId,
          `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
            `A maioria votou para remover (${contest.votes.remove} vs ${contest.votes.keep}), mas houve um erro ao processar a remoção.\n` +
            `Entre em contato com um administrador.`,
        );
      }
    } else {
      // Manter treino
      await client.sendMessage(
        chatId,
        `⚖️ *CONTESTAÇÃO ENCERRADA*\n\n` +
          `📊 Resultado: ${contest.votes.remove} votos para remover vs ${contest.votes.keep} para manter\n\n` +
          `✅ O treino de *${targetName}* (${workoutDate}) foi *MANTIDO*.`,
      );
    }

    // Cleanup
    activeContests.delete(pollId);

    // Remove poll from backend
    try {
      await backendClient.sendToBackend(`/api/polls/${pollId}`, null, "DELETE");
    } catch (err) {
      logger.warn(`[contestar] Erro ao deletar poll: ${err.message}`);
    }
  } catch (err) {
    logger.error(`[contestar] handleContestVote erro:`, err);
  }
}
