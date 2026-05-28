"use strict";

const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");

module.exports = {
  name: "tabela",
  aliases: ["grupo"],
  description: "Abre a tabela da Copa do Mundo. Ex: /tabela ou /tabela grupo a",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;

    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[tabela] getContact:", e.message);
    }

    try {
      // Abre o flow copa direto no nó /tabela (seleção de grupo via enquete)
      await flowManager.startFlow(client, chatId, userId, "copa", { initialPath: "/tabela" });
    } catch (e) {
      logger.error("[tabela]", e.message);
      await client.sendMessage(chatId, "❌ Erro ao abrir tabela: " + e.message);
    }
  },
};
