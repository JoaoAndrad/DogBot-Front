const backendClient = require("../services/backendClient");
const conversationState = require("../services/conversationState");
const pollComponent = require("../components/poll");
const logger = require("../utils/logger");

/**
 * Handle meta conversation flow
 * Steps:
 * 0 - Ask if goal should be public (via poll)
 * 1 - Wait for poll vote (visibility)
 * 2 - Ask for goal value
 * 3 - Save goal
 */
async function handleMetaFlow(userId, body, state, reply, context) {
  const { step, data } = state;

  logger.info(
    `[MetaFlow] Handler chamado para userId=${userId}, step=${step}, body="${body}"`,
  );

  // Step 0: Show visibility poll
  if (step === 0) {
    await reply(
      "🎯 *Configuração de Meta Anual*\n\n" +
        "Vamos configurar sua meta de treinos para o ano!\n" +
        "Primeiro, responda:",
    );

    // Create poll for visibility
    try {
      const chatId = userId;
      const client = context.client;

      if (!client) {
        logger.error("[Meta] Cliente WhatsApp não disponível");
        conversationState.clearState(userId);
        return reply(
          "❌ Erro ao criar enquete. Digite /meta para tentar novamente.",
        );
      }

      const result = await pollComponent.createPoll(
        client,
        chatId,
        "Deseja que essa meta de treinos seja visível para outros usuários?",
        ["✅ Sim", "❌ Não"],
        {
          onVote: async (voteData) => {
            await handleMetaVisibilityVote(userId, voteData, reply, context);
          },
        },
      );

      if (result) {
        logger.info(`[Meta] Poll de visibilidade criada: ${result.msgId}`);
        conversationState.updateData(userId, { pollId: result.msgId });
        conversationState.nextStep(userId);
      } else {
        logger.error("[Meta] Falha ao criar poll");
        conversationState.clearState(userId);
        return reply(
          "❌ Erro ao criar enquete. Digite /meta para tentar novamente.",
        );
      }
    } catch (err) {
      logger.error("[Meta] Erro ao criar poll:", err);
      conversationState.clearState(userId);
      return reply(
        "❌ Erro ao criar enquete. Digite /meta para tentar novamente.",
      );
    }

    return; // Wait for vote
  }

  // Step 1: Waiting for poll vote (handled by poll callback)
  if (step === 1) {
    if (context && context.isGroup) {
      return; // Ignore group messages
    }
    return reply("⏳ Aguardando sua resposta na enquete acima...");
  }

  // Step 2: Collect goal value
  if (step === 2) {
    const goalStr = body.trim();

    // Validate numeric input
    if (!/^\d+$/.test(goalStr)) {
      return reply("❌ Por favor, digite apenas um número entre 1 e 365.");
    }

    const goalValue = parseInt(goalStr);

    // Validate range
    if (goalValue < 1 || goalValue > 365) {
      return reply("❌ A meta deve ser entre 1 e 365 treinos por ano.");
    }

    // Save goal
    try {
      const result = await backendClient.sendToBackend(
        "/api/workouts/set-goal",
        {
          senderNumber: data.identifier,
          annualGoal: goalValue,
          isPublic: data.isPublic,
        },
        "POST",
      );

      conversationState.clearState(userId);

      if (result.success) {
        const visibilityText = data.isPublic
          ? "Sua meta será visível para outros usuários nos grupos."
          : "Sua meta é privada, visível apenas para você.";

        return reply(
          `✅ *Meta anual definida com sucesso!*\n\n` +
            `🎯 Meta: ${goalValue} treino${goalValue > 1 ? "s" : ""} no ano\n` +
            `👁️ ${visibilityText}\n\n` +
            `Boa sorte! 💪🔥`,
        );
      } else {
        return reply(
          result.message ||
            "❌ Erro ao salvar meta. Digite /meta para tentar novamente.",
        );
      }
    } catch (err) {
      logger.error("[Meta] Erro ao salvar meta:", err);
      conversationState.clearState(userId);
      return reply(
        "❌ Erro ao salvar meta. Digite /meta para tentar novamente.",
      );
    }
  }

  // Fallback: unknown step
  conversationState.clearState(userId);
  return reply("❌ Erro no processo. Por favor, digite /meta para recomeçar.");
}

/**
 * Handle vote on visibility poll
 */
async function handleMetaVisibilityVote(userId, voteData, reply, context) {
  const state = conversationState.getState(userId);

  if (!state || state.flowType !== "meta" || state.step !== 1) {
    logger.debug(`[Meta] Vote ignorado - estado inválido para ${userId}`);
    return;
  }

  const { selectedIndexes } = voteData;
  const selectedIndex = selectedIndexes && selectedIndexes[0];

  // Option 0: Sim (public), Option 1: Não (private)
  const isPublic = selectedIndex === 0;

  conversationState.updateData(userId, { isPublic });
  conversationState.nextStep(userId); // Move to step 2

  // Ask for goal value
  await reply(
    `${isPublic ? "👁️ Meta pública selecionada" : "🔒 Meta privada selecionada"}.\n\n` +
      `Agora, informe sua meta anual de treinos.\n` +
      `📝 Digite um número entre 1 e 365:`,
  );
}

module.exports = {
  handleMetaFlow,
};
