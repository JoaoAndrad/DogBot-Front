const backendClient = require("../services/backendClient");
const conversationState = require("../services/conversationState");
const pollComponent = require("../components/poll");
const logger = require("../utils/logger");

/**
 * Format a WhatsApp JID (e.g. "5581982132346@c.us") into a readable phone number.
 * For Brazilian numbers (+55): "+55 (DDD) NNNNN-NNNN"
 * For others: just the bare number without the @suffix.
 */
function formatWhatsAppId(jid) {
  if (!jid) return jid;
  // Strip suffix (@c.us, @s.whatsapp.net, etc.)
  const number = String(jid).replace(/@.*$/, "");
  // Brazilian mobile: 55 + 2-digit DDD + 9-digit number = 13 digits
  if (/^55\d{11}$/.test(number)) {
    const ddd = number.slice(2, 4);
    const part1 = number.slice(4, 9);
    const part2 = number.slice(9);
    return `+55 (${ddd}) ${part1}-${part2}`;
  }
  // Brazilian landline: 55 + 2-digit DDD + 8-digit number = 12 digits
  if (/^55\d{10}$/.test(number)) {
    const ddd = number.slice(2, 4);
    const part1 = number.slice(4, 8);
    const part2 = number.slice(8);
    return `+55 (${ddd}) ${part1}-${part2}`;
  }
  return number;
}

/**
 * Handle cadastro conversation flow
 * Steps:
 * 0 - Ask for name
 * 1 - Wait for poll vote (confirmation)
 */
async function handleCadastroFlow(userId, body, state, reply, context) {
  const { step, data } = state;

  logger.info(
    `[CadastroFlow] Handler chamado para userId=${userId}, step=${step}, body="${body}"`,
  );

  // Step 0: Collect name
  if (step === 0) {
    const userName = body.trim();

    // Validate name
    if (userName.length < 2) {
      return reply("❌ Por favor, digite um nome com pelo menos 2 caracteres.");
    }

    if (userName.length > 50) {
      return reply("❌ Nome muito longo. Por favor, use até 50 caracteres.");
    }

    // Save name and advance to confirmation
    conversationState.updateData(userId, { userName });
    conversationState.nextStep(userId);

    // Log data to be sent (frontend console)
    logger.info(`[Cadastro] Dados coletados para ${userId}:`, {
      identifier: data.identifier,
      userName: userName,
      push_name: data.push_name,
      display_name: userName,
      observed_from: data.observed_from,
      observed_lid: data.observed_lid,
    });

    // Show confirmation message
    const formattedContact = formatWhatsAppId(data.identifier);
    await reply(
      `📋 *Confirmação de Cadastro*\n\n` +
        `Nome: *${userName}*\n` +
        `Contato: *${formattedContact}*\n\n` +
        `Os dados acima estão corretos?`,
    );

    // Create poll for confirmation
    try {
      // Use userId (actual number @c.us) instead of observed_from (@lid)
      const chatId = userId;
      const client = context.client;

      if (!client) {
        logger.error("[Cadastro] Cliente WhatsApp não disponível");
        conversationState.clearState(userId);
        return reply(
          "❌ Erro ao criar enquete. Digite /cadastro para tentar novamente.",
        );
      }

      const result = await pollComponent.createPoll(
        client,
        chatId,
        "Confirmar cadastro?",
        ["✅ Sim, confirmar", "❌ Não, cancelar"],
        {
          onVote: async (voteData) => {
            await handleCadastroVote(userId, voteData, reply);
          },
        },
      );

      if (result) {
        logger.info(`[Cadastro] Poll de confirmação criada: ${result.msgId}`);
        conversationState.updateData(userId, { pollId: result.msgId });
      } else {
        logger.error("[Cadastro] Falha ao criar poll");
        conversationState.clearState(userId);
        return reply(
          "❌ Erro ao criar enquete. Digite /cadastro para tentar novamente.",
        );
      }
    } catch (err) {
      logger.error("[Cadastro] Erro ao criar poll:", err);
      conversationState.clearState(userId);
      return reply(
        "❌ Erro ao criar enquete. Digite /cadastro para tentar novamente.",
      );
    }

    return; // Wait for vote
  }

  // If user sends text during step 1, only notify when message is from private chat
  if (step === 1) {
    if (context && context.isGroup) {
      // Ignore group messages while waiting for the user's poll vote in private
      return;
    }
    return reply("⏳ Aguardando sua resposta na enquete acima...");
  }

  // Fallback: unknown step
  conversationState.clearState(userId);
  return reply(
    "❌ Erro no processo de cadastro. Por favor, digite /cadastro para recomeçar.",
  );
}

/**
 * Handle vote on cadastro confirmation poll
 */
async function handleCadastroVote(userId, voteData, reply) {
  const state = conversationState.getState(userId);

  if (!state || state.flowType !== "cadastro" || state.step !== 1) {
    logger.debug(`[Cadastro] Vote ignorado - estado inválido para ${userId}`);
    return;
  }

  const { selectedIndexes, selectedNames } = voteData;

  // Em chat privado, quem vota só pode ser o próprio usuário
  // Não precisa verificar voter vs userId

  const selectedIndex = selectedIndexes && selectedIndexes[0];
  const finalData = state.data;

  // Option 0: Sim, confirmar
  if (selectedIndex === 0) {
    try {
      // Send to backend
      const res = await backendClient.sendToBackend("/api/users/upsert", {
        identifier: finalData.identifier,
        push_name: finalData.push_name,
        display_name: finalData.userName,
        observed_from: finalData.observed_from,
        observed_lid: finalData.observed_lid,
      });

      // Clear conversation state
      conversationState.clearState(userId);

      if (res && res.success) {
        logger.info(`[Cadastro] ✅ Usuário cadastrado com sucesso:`, {
          userId,
          userName: finalData.userName,
          backendResponse: res,
        });

        return reply(
          `🎉 *Cadastro realizado com sucesso!*\n\n` +
            `Bem-vindo, *${finalData.userName}*!\n\n` +
            `Agora você pode usar todos os comandos:\n` +
            `• /spotify - Conectar sua conta do Spotify\n\n` +
            `Divirta-se! 🚀`,
        );
      }

      return reply(
        "❌ Erro ao realizar cadastro. Tente novamente em alguns instantes.",
      );
    } catch (err) {
      logger.error("[Cadastro] Erro ao salvar cadastro:", err && err.message);
      conversationState.clearState(userId);
      return reply(
        "❌ Erro ao realizar cadastro. Tente novamente em alguns instantes.",
      );
    }
  }

  // Option 1: Não, cancelar
  if (selectedIndex === 1) {
    conversationState.clearState(userId);
    return reply(
      "❌ Cadastro cancelado.\n\nDigite /cadastro para tentar novamente.",
    );
  }

  // Invalid option
  logger.warn(`[Cadastro] Voto inválido: index=${selectedIndex}`);
}

module.exports = {
  handleCadastroFlow,
  handleCadastroVote,
};
