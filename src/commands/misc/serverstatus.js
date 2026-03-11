"use strict";

const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "serverstatus",
  aliases: ["status", "relatorio"],
  description: "Envia o relatório de estatísticas do bot (apenas administradores, no privado)",

  async execute(ctx) {
    const msg = ctx.message;
    const reply = ctx.reply;
    const from = msg.from || (msg._data && msg._data.from);
    const author = msg.author || msg.from;
    const isGroup = !!(msg && msg.isGroup);

    if (isGroup) {
      await reply("Use /serverstatus no meu *privado* para ver o relatório.");
      return;
    }

    let actualNumber = from;
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        actualNumber = contact.id._serialized;
      }
    } catch (err) {
      actualNumber = from;
    }

    try {
      const lookupRes = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(actualNumber)}`,
        null,
        "GET"
      );

      if (!lookupRes || !lookupRes.found) {
        await reply("Acesso restrito a administradores.");
        return;
      }

      if (!lookupRes.isAdmin) {
        await reply("Acesso restrito a administradores.");
        return;
      }

      const text = await backendClient.getBackendText(
        "/api/status?format=message&hoursBack=24"
      );
      await reply(text);
    } catch (err) {
      logger.error("[serverstatus] Error:", err && err.message);
      await reply("Não foi possível obter o relatório. Tente mais tarde.");
    }
  },
};
