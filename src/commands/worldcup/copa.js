"use strict";

const worldcupClient = require("../../services/worldcupClient");
const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");

module.exports = {
  name: "copa",
  aliases: [],
  description: "Abre o menu interativo da Copa do Mundo",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[copa] getContact error:", e.message);
    }

    if (isGroup) {
      try {
        const settings = await worldcupClient.getGroupSettings(chatId);
        if (!settings || !settings.active) {
          await client.sendMessage(chatId, "⚽ O sistema Copa do Mundo não está ativo neste grupo.\nUse */clima-de-copa* para ativar.");
          return;
        }
      } catch (e) {
        logger.error("[copa] getGroupSettings error:", e.message);
      }
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "copa");
    } catch (e) {
      await client.sendMessage(chatId, "❌ Erro ao abrir menu da Copa: " + e.message);
    }
  },
};
