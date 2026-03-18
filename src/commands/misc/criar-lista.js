/**
 * commands/misc/criar-lista.js — Command to create a new list
 * Usage: /criar-lista [optional name]
 */

const conversationState = require("../../services/conversationState");
const { handleListFlow } = require("../../handlers/listFlowHandler");
const listClient = require("../../services/listClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "criar-lista",
  aliases: ["criarLista", "novalist", "createlist"],
  description: "📝 Criar uma nova lista de filmes/séries",

  async execute(context) {
    const { message, reply, client } = context;
    const msg = message;
    let userId = msg.author || msg.from;

    // Try to get accurate user ID
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        userId = contact.id._serialized;
      }
    } catch (err) {
      logger.debug("[criar-lista] Error getting contact:", err.message);
    }

    const body = msg.body || "";
    const args = body.replace(/^\/criar-?lista\s*/i, "").trim();

    // If user provided a name directly, create it immediately
    if (args) {
      try {
        logger.info(`[criar-lista] Criando lista com nome: "${args}"`);
        const newList = await listClient.createList(args, userId);

        if (!newList) {
          return reply("❌ Erro ao criar lista. Tente novamente.");
        }

        return reply(
          `✅ *Lista criada com sucesso!*\n\n` +
            `📋 ${newList.title}\n\n` +
            `Agora você pode:\n` +
            `• Usar /filme para buscar e adicionar filmes\n` +
            `• Usar /listas para gerenciar suas listas`,
        );
      } catch (err) {
        logger.error("[criar-lista] Error creating list:", err.message);
        return reply(`❌ Erro: ${err.message}`);
      }
    }

    // Otherwise, start interactive flow
    conversationState.startFlow(userId, "list-creation", {});
    const state = conversationState.getState(userId);

    return handleListFlow(userId, "", state, reply, { client, message: msg });
  },
};
