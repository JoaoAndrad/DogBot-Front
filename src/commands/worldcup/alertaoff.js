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

    // Resolve o userId do autor (funciona tanto no privado quanto no grupo)
    let userId = isGroup ? (message.author || message.from) : chatId;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized)
        userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[alertaoff] getContact error:", e.message);
    }

    try {
      await worldcupClient.setDmAlerts(userId, false);
      const replyTo = isGroup ? chatId : chatId;
      await client.sendMessage(
        replyTo,
        "🔕 Certo! Você não vai mais receber notificações de palpite no privado nem ser mencionado em grupos.\n\nSe mudar de ideia, envie */alertaon* para reativar.",
      );
    } catch (e) {
      logger.error("[alertaoff] error:", e.message);
      await client.sendMessage(chatId, "❌ Erro ao salvar preferência: " + e.message);
    }
  },
};
