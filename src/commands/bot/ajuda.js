const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");
const { jidFromContact } = require("../../utils/whatsapp/getUserData");

module.exports = {
  name: "ajuda",
  aliases: ["help"],
  description: "Menu de ajuda do bot (privado)",
  async execute(ctx) {
    const msg = ctx.message;
    const client = ctx.client;
    const reply = ctx.reply;

    if (!client || !msg) {
      if (typeof reply === "function") {
        await reply("❌ Não foi possível iniciar a ajuda.");
      }
      return;
    }

    const chatId = msg.from;
    let userId = msg.author || msg.from;
    try {
      const contact = await msg.getContact();
      const j = jidFromContact(contact);
      if (j) userId = j;
    } catch (err) {
      logger.debug("[Command:ajuda] getContact:", err && err.message);
    }

    const info = ctx.info || {};
    let isGroup = !!(msg && msg.isGroup) || !!info.is_group;
    if (!isGroup && chatId && String(chatId).endsWith("@g.us")) {
      isGroup = true;
    }

    if (isGroup) {
      return reply(
        "⚠️ A ajuda só funciona no privado. Envie /ajuda ou /help no meu chat direto com o bot.",
      );
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "ajuda");
    } catch (err) {
      logger.error("[Command:ajuda] startFlow:", err);
      await reply("❌ Erro ao abrir a ajuda: " + (err && err.message ? err.message : err));
    }
  },
};
