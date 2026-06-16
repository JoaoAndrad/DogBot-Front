"use strict";

const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "alertaon",
  aliases: ["alertason", "alertas"],
  description: "Reativa os DMs de lembrete de palpite 1h antes dos jogos",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    if (isGroup) {
      await client.sendMessage(
        chatId,
        "⚙️ Envie */alertaon* no privado para reativar as notificações de jogo.",
      );
      return;
    }

    let userId = chatId;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized)
        userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[alertaon] getContact error:", e.message);
    }

    try {
      await worldcupClient.setDmAlerts(userId, true);
      await client.sendMessage(
        chatId,
        "🔔 Notificações reativadas! Você vai receber avisos 1h antes dos jogos quando ainda não tiver palpitado.",
      );
    } catch (e) {
      logger.error("[alertaon] error:", e.message);
      await client.sendMessage(chatId, "❌ Erro ao salvar preferência: " + e.message);
    }
  },
};
