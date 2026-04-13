const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const conversationState = require("../../services/conversationState");

module.exports = {
  name: "cadastro",
  aliases: ["registro", "criar-conta  ", "criarconta", "criar"],
  description: "Registra-se no sistema para usar comandos",
  async execute(ctx) {
    const msg = ctx.message;
    const info = ctx.info || {};
    const reply = ctx.reply;

    const author = msg.author || msg.from || info.from;
    const pushName =
      (msg && msg._data && msg._data.notifyName) || info.pushName;
    const displayName = pushName || info.display_name;
    let isGroup = !!(msg && msg.isGroup) || !!info.is_group;
    // Fallback: detect group chat by chat id suffix when isGroup flag is absent
    if (!isGroup) {
      const chatId = (msg && msg.from) || info.from || "";
      if (chatId && String(chatId).endsWith("@g.us")) isGroup = true;
    }
    const from = info.from || msg.from;

    // Cadastro só funciona no privado
    if (isGroup) {
      return reply(
        "⚠️ Cadastros são feitos somente no privado.\n\n" +
          "Por favor, envie /cadastro no meu chat privado."
      );
    }

    // Try to get actual phone number from contact
    let actualNumber = null;
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        actualNumber = contact.id._serialized;
        logger.debug(`[Cadastro] Número do contato: ${actualNumber}`);
      }
    } catch (err) {
      logger.debug(`[Cadastro] Erro ao buscar contato:`, err.message);
    }

    // Fallback: use from/author if contact fetch failed
    if (!actualNumber) {
      if (!isGroup) {
        actualNumber = from;
      } else {
        actualNumber = author;
      }
      logger.debug(`[Cadastro] Usando fallback: ${actualNumber}`);
    }

    // Extract LID if from group
    let observedLid = null;
    if (isGroup && author && author.includes("@lid")) {
      observedLid = author;
    }

    if (!actualNumber) {
      return reply("❌ Não consegui identificar seu número. Tente novamente.");
    }

    // Check if user already exists
    try {
      logger.info(`[Cadastro] Verificando usuário existente: ${actualNumber}`);
      const lookupRes = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(actualNumber)}`,
        null,
        "GET"
      );

      logger.info(`[Cadastro] Resposta do lookup:`, lookupRes);

      if (lookupRes && lookupRes.found) {
        return reply(
          `✅ Você já está cadastrado!\n\n` +
            `${
              pushName ? pushName + ", você" : "Você"
            } pode usar os comandos normalmente.\n\n` +
            `Digite /ajuda para ver os comandos disponíveis.`
        );
      }

      logger.info(
        `[Cadastro] Usuário não encontrado, iniciando cadastro para: ${actualNumber}`
      );
    } catch (err) {
      logger.error("Error checking existing user:", err);
      logger.error("Error details:", {
        message: err.message,
        stack: err.stack,
        response: err.response,
      });
      return reply(
        "❌ Erro ao verificar cadastro. Tente novamente em alguns instantes."
      );
    }

    // Start conversation flow for registration
    conversationState.startFlow(actualNumber, "cadastro", {
      identifier: actualNumber,
      push_name: pushName,
      display_name: displayName,
      observed_from: from,
      observed_lid: observedLid,
      isGroup,
    });

    logger.info(`[Cadastro] Iniciando fluxo para ${actualNumber}`);

    return reply(
      `👋 Olá! Vamos iniciar o seu cadastro.\n\n` +
        `Para começar, por favor me diga:\n` +
        `*Qual nome você gostaria de usar?*\n\n` +
        `(Pode ser seu nome, apelido ou como prefere ser chamado)`
    );
  },
};
