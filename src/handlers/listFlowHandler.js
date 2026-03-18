/**
 * createListFlowHandler - Handle lista creation flow
 * Steps:
 * 0 - Ask for list name
 * 1 - Collect list name and create
 */

const conversationState = require("../services/conversationState");
const listClient = require("../services/listClient");
const logger = require("../utils/logger");

async function handleListFlow(userId, body, state, reply, context) {
  const { step, data } = state;

  logger.info(
    `[ListFlow] Handler chamado para userId=${userId}, step=${step}, body="${body}"`,
  );

  // Step 0: Ask for list name
  if (step === 0) {
    conversationState.nextStep(userId);
    return reply(
      "📝 *Criar Nova Lista*\n\n" +
        "Digite o nome da sua nova lista:\n\n" +
        "_Exemplo: Filmes Favoritos, Séries para Assistir, etc._",
    );
  }

  // Step 1: Collect name and create list
  if (step === 1) {
    const listName = body.trim();

    // Validate input
    if (listName.length < 1) {
      return reply("❌ O nome da lista não pode estar vazio!");
    }

    if (listName.length > 50) {
      return reply("❌ O nome da lista deve ter no máximo 50 caracteres.");
    }

    try {
      logger.info(
        `[ListFlow] Criando lista "${listName}" para userId=${userId}`,
      );

      // Create list via API (private or group, based on current context)
      const groupChatId = context?.isGroup ? context?.from : null;
      const newList = await listClient.createList(userId, {
        title: listName,
        groupChatId,
      });

      if (!newList) {
        conversationState.clearState(userId);
        return reply(
          "❌ Erro ao criar lista. Abra /listas e toque em "Criar nova lista" novamente",
        );
      }

      conversationState.clearState(userId);

      return reply(
        `✅ *Lista criada com sucesso!*\n\n` +
          `📋 ${newList.title}\n\n` +
          `Agora você pode:\n` +
          `• Usar /filme para buscar e adicionar filmes\n` +
          `• Usar /listas para gerenciar suas listas`,
      );
    } catch (err) {
      logger.error("[ListFlow] Erro ao criar lista:", err.message);
      conversationState.clearState(userId);
      return reply(
        `❌ Erro ao criar lista: ${err.message}\n\n` +
          `Abra /listas e toque em "Criar nova lista" novamente`,
      );
    }
  }
}

module.exports = { handleListFlow };
