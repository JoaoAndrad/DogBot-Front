"use strict";

const flowManager = require("../components/menu/flowManager");
const logger = require("../utils/logger");

module.exports = {
  name: "financeiro",
  aliases: ["fin", "finance", "finanças"],
  description: "Abre o assistente financeiro pessoal",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    if (isGroup) {
      await client.sendMessage(chatId, "💰 O assistente financeiro funciona apenas no privado.\nMe mande uma mensagem direta para começar.");
      return;
    }

    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[financeiro] getContact error:", e.message);
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "financeiro");
    } catch (e) {
      logger.error("[financeiro] startFlow error:", e.message);
      await client.sendMessage(chatId, "❌ Erro ao abrir o assistente financeiro. Tente novamente.");
    }
  },
};
