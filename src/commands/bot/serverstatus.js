"use strict";

const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const {
  jidFromContact,
  lookupByIdentifier,
} = require("../../utils/whatsapp/getUserData");

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
      const j = jidFromContact(contact);
      if (j) actualNumber = j;
    } catch (err) {
      actualNumber = from;
    }

    try {
      const lookupRes = await lookupByIdentifier(actualNumber);

      if (lookupRes === null) {
        logger.error("[serverstatus] lookupByIdentifier falhou");
        await reply(
          "Não foi possível verificar o acesso. Tente mais tarde.",
        );
        return;
      }

      if (!lookupRes.found || !lookupRes.isAdmin) {
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
