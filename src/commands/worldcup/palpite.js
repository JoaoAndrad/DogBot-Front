"use strict";

const worldcupClient = require("../../services/worldcupClient");
const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");

module.exports = {
  name: "palpite",
  aliases: [],
  description: "Abre o flow de palpites da Copa (somente no privado)",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    if (isGroup) {
      await client.sendMessage(chatId, "⚽ Os palpites são feitos no privado!\nEnvie */palpite* diretamente para mim no privado.");
      return;
    }

    let userId = message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[palpite] getContact error:", e.message);
    }

    // Check if user is in at least one active Copa group
    try {
      const chatsRaw = await client.getChats();
      const groupIds = chatsRaw
        .filter((c) => c.isGroup)
        .map((c) => c.id._serialized || c.id.user + "@g.us");

      const { hasGroup } = await worldcupClient.userHasActiveGroup(userId, groupIds);

      if (!hasGroup) {
        await client.sendMessage(
          chatId,
          "⚽ Você precisa estar em um grupo com o sistema Copa ativado para fazer palpites.\nPeça para alguém enviar */clima-de-copa* no grupo.",
        );
        return;
      }
    } catch (e) {
      logger.error("[palpite] group check error:", e.message);
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "copa-palpite");
    } catch (e) {
      await client.sendMessage(chatId, "❌ Erro ao abrir palpite: " + e.message);
    }
  },
};
