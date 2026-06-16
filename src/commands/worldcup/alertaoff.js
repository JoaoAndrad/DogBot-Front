"use strict";

const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "alertaoff",
  aliases: ["alertasoff", "semalerti", "semaviso"],
  description: "Para de receber DMs de lembrete de palpite 1h antes dos jogos",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    if (isGroup) {
      await client.sendMessage(
        chatId,
        "⚙️ Envie */alertaoff* no privado para desativar as notificações de jogo.",
      );
      return;
    }

    let userId = chatId;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized)
        userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[alertaoff] getContact error:", e.message);
    }

    try {
      await worldcupClient.setDmAlerts(userId, false);
      await client.sendMessage(
        chatId,
        "🔕 Pronto! Você não vai mais receber notificações de palpite no privado.\n\nSe mudar de ideia, envie */alertaon* para reativar.",
      );
    } catch (e) {
      logger.error("[alertaoff] error:", e.message);
      await client.sendMessage(chatId, "❌ Erro ao salvar preferência: " + e.message);
    }
  },
};
