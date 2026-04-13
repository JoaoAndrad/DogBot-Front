const conversationState = require("../../services/conversationState");
const logger = require("../../utils/logger");
const { jidFromContact } = require("../../utils/whatsapp/getUserData");

module.exports = {
  name: "meta",
  description: "Definir meta anual de treinos",
  async execute(ctx) {
    const msg = ctx.message;
    const info = ctx.info || {};
    const reply = ctx.reply;

    const author = msg.author || msg.from || info.from;
    const pushName =
      (msg && msg._data && msg._data.notifyName) || info.pushName;
    let isGroup = !!(msg && msg.isGroup) || !!info.is_group;
    // Fallback: detect group chat by chat id suffix when isGroup flag is absent
    if (!isGroup) {
      const chatId = (msg && msg.from) || info.from || "";
      if (chatId && String(chatId).endsWith("@g.us")) isGroup = true;
    }
    const from = info.from || msg.from;

    // Meta só funciona no privado
    if (isGroup) {
      return reply(
        "⚠️ Definição de meta é feita somente no privado.\n\n" +
          "Por favor, envie /meta no meu chat privado.",
      );
    }

    // Try to get actual phone number from contact
    let actualNumber = null;
    try {
      const contact = await msg.getContact();
      const jid = jidFromContact(contact);
      actualNumber =
        jid || (contact && contact.id && contact.id._serialized) || null;
      if (actualNumber) {
        logger.debug(`[Meta] Número do contato: ${actualNumber}`);
      }
    } catch (err) {
      logger.debug(`[Meta] Erro ao buscar contato:`, err.message);
    }

    // Fallback: use from/author if contact fetch failed
    if (!actualNumber) {
      if (!isGroup) {
        actualNumber = from;
      } else {
        actualNumber = author;
      }
      logger.debug(`[Meta] Usando fallback: ${actualNumber}`);
    }

    if (!actualNumber) {
      return reply("❌ Não consegui identificar seu número. Tente novamente.");
    }

    // Start conversation flow for meta definition
    conversationState.startFlow(actualNumber, "meta", {
      identifier: actualNumber,
      push_name: pushName,
      isGroup,
    });

    logger.info(`[Meta] Iniciando fluxo para ${actualNumber}`);

    // Flow will continue in metaFlowHandler (step 0)
    // Just return here - handler will show the poll
    return;
  },
};
