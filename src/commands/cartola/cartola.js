"use strict";

const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");

module.exports = {
  name: "cartola",
  aliases: [],
  description: "Abre o menu interativo do Cartola FC",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;

    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[cartola] getContact error:", e.message);
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "cartola");
    } catch (e) {
      await client.sendMessage(chatId, "❌ Erro ao abrir menu do Cartola: " + e.message);
    }
  },
};
