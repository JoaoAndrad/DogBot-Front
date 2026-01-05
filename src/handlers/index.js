const logger = require("../utils/logger");
const commands = require("../commands");
const backendClient = require("../services/backendClient");
const spotifyService = require("../services/spotifyService");
const conversationState = require("../services/conversationState");
const { handleCadastroFlow } = require("./cadastroFlowHandler");

async function handle(context) {
  // Accept either context.info (legacy) or context.msg (whatsapp-web.js)
  const info = context.info || {};
  const msg = context.msg || {};
  const body = String(info.body || msg.body || "").trim();
  const from = info.from || msg.from;

  // Log resumido da mensagem
  try {
    const isGroup = !!(msg && msg.isGroup) || !!info.is_group;
    const author = msg.author || msg.from || info.from;
    const authorName =
      (msg._data && msg._data.notifyName) || info.pushName || author;
    const msgType = msg.type || info.type || "text";

    let logMsg = `📩 ${msgType}`;
    if (isGroup) {
      // Get group name - use getChat() to get full info
      let groupName = from.split("@")[0];
      try {
        const chat = await msg.getChat();
        if (chat && chat.name) {
          groupName = chat.name;
        }
      } catch (e) {
        // keep fallback groupName
      }

      logMsg += ` | 👥 ${groupName} | 👤 ${authorName}`;
    } else {
      logMsg += ` | 👤 ${authorName}`;
    }
    if (body)
      logMsg += ` | 💬 ${body.slice(0, 50)}${body.length > 50 ? "..." : ""}`;

    console.log(logMsg);
  } catch (err) {
    console.log(`📩 Mensagem de ${from}`);
  }

  // Note: No longer auto-creating users on regular messages
  // Users must explicitly register with /cadastro command

  // prepare reply helper
  const reply = async (text) => {
    try {
      if (typeof msg.reply === "function") return await msg.reply(text);
      if (context.client && from)
        return await context.client.sendMessage(from, text);
      return null;
    } catch (err) {
      logger.error("Erro ao enviar reply:", err);
    }
  };

  // Check if user is in an active conversation flow (e.g., cadastro)
  const author = msg.author || msg.from || info.from;
  const isGroup = !!(msg && msg.isGroup) || !!info.is_group;

  let actualNumber = null;
  if (!isGroup) {
    // Try to get contact first for consistency with command
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        actualNumber = contact.id._serialized;
      } else {
        actualNumber = from;
      }
    } catch (err) {
      actualNumber = from;
    }
  } else {
    actualNumber = author ? author.replace(/@lid$/i, "") : null;
  }

  //logger.debug(`[Handler] Verificando fluxo ativo para: ${actualNumber}`);

  if (actualNumber && conversationState.hasActiveFlow(actualNumber)) {
    const state = conversationState.getState(actualNumber);
    logger.debug(
      `[Handler] Fluxo ativo detectado para ${actualNumber}: ${state.flowType}`
    );

    if (state.flowType === "cadastro") {
      return await handleCadastroFlow(actualNumber, body, state, reply, {
        author,
        isGroup,
        from,
        pushName: (msg && msg._data && msg._data.notifyName) || info.pushName,
        client: context.client,
      });
    }
  }

  // Forward a normalized message record to backend for storage/processing (no chat fallback)
  try {
    const msgId =
      (msg && msg.id && (msg.id._serialized || msg.id.id)) ||
      info.message_id ||
      undefined;
    const payload = {
      message_id: msgId,
      chat_id: from,
      from_id: info.from || msg.author || msg.from,
      display_name:
        (msg && msg._data && msg._data.notifyName) ||
        info.pushName ||
        undefined,
      is_group: !!(msg && msg.isGroup) || !!info.is_group,
      body: body || undefined,
      snippet: body ? body.slice(0, 200) : undefined,
      has_media:
        !!(msg && msg.hasMedia) || !!(msg && msg._data && msg._data.isMedia),
      media_meta: (msg && msg.media) || undefined,
      msg_type: msg && msg.type,
      received_at: new Date().toISOString(),
      origin: "whatsapp-frontend",
    };

    backendClient.sendToBackend("/api/messages/", payload).catch((err) => {
      logger.debug("failed to send message to backend", err && err.message);
    });
  } catch (err) {
    logger.debug("error preparing backend message payload", err && err.message);
  }

  // detect command: prefix-based (! or /) or exact keyword fallback (e.g. 'ping')
  // normalize by removing diacritics so 'confissão' or 'Confissao' match 'confissao'
  let isCommand = false;
  let cmdName = null;
  function normalizeCmdName(s) {
    if (!s) return "";
    try {
      return String(s)
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    } catch (e) {
      return String(s).trim().toLowerCase();
    }
  }

  if (body.startsWith("!") || body.startsWith("/")) {
    isCommand = true;
    const raw = body.slice(1).split(/\s+/)[0];
    cmdName = normalizeCmdName(raw);
  } else if (body.length) {
    const raw = body.split(/\s+/)[0];
    const normalized = normalizeCmdName(raw);
    if (commands.commands.has(normalized)) {
      isCommand = true;
      cmdName = normalized;
    }
  }

  if (isCommand && cmdName) {
    const cmd = commands.getCommand(cmdName);
    if (!cmd) {
      logger.debug("Comando não encontrado:", cmdName);
      await reply(`Comando desconhecido: ${cmdName}`);
      return;
    }

    // Commands that don't require user registration
    const publicCommands = ["cadastro", "ajuda", "help"];
    const requiresRegistration = !publicCommands.includes(cmdName);

    // Check if user exists before executing command (unless public command)
    if (requiresRegistration) {
      try {
        const author = msg.author || msg.from || info.from;
        const isGroup = !!(msg && msg.isGroup) || !!info.is_group;

        // Try to get actual phone number from contact
        let actualNumber = null;
        try {
          const contact = await msg.getContact();
          if (contact && contact.id && contact.id._serialized) {
            actualNumber = contact.id._serialized;
            logger.debug(`[Handler] Número do contato: ${actualNumber}`);
          }
        } catch (err) {
          logger.debug(`[Handler] Erro ao buscar contato:`, err.message);
        }

        // Fallback: use from/author if contact fetch failed
        if (!actualNumber) {
          if (!isGroup) {
            actualNumber = from;
          } else {
            actualNumber = author ? author.replace(/@lid$/i, "") : null;
          }
          logger.debug(`[Handler] Usando fallback: ${actualNumber}`);
        }

        if (actualNumber) {
          logger.debug(`[Handler] Verificando cadastro para: ${actualNumber}`);
          const lookupRes = await backendClient.sendToBackend(
            `/api/users/lookup?identifier=${encodeURIComponent(actualNumber)}`,
            null,
            "GET"
          );

          logger.debug(`[Handler] Resultado lookup:`, lookupRes);

          if (!lookupRes || !lookupRes.found) {
            if (isGroup) {
              await reply(
                "hmmm parece que não te conheço... venha no meu privado e digite /cadastro"
              );
            } else {
              await reply(
                "É necessário enviar /cadastro no privado antes de utilizar qualquer comando"
              );
            }
            return;
          }
        }
      } catch (err) {
        logger.error("Erro ao verificar usuário:", err);
        // Continue execution on lookup error to avoid blocking legitimate users
      }
    }

    const ctx = {
      message: msg,
      info,
      client: context.client,
      reply,
      services: { backend: backendClient, spotify: spotifyService },
    };

    try {
      await cmd.execute(ctx);
    } catch (err) {
      logger.error("Erro ao executar comando", cmdName, err);
      await reply("Ocorreu um erro ao executar o comando.");
    }

    return;
  }

  // fallback: numeric reply to vote for latest poll in this chat
  try {
    const numeric = body.match(/^\s*([1-9][0-9]*)\s*$/);
    if (numeric && from) {
      const idx = parseInt(numeric[1], 10) - 1;
      const pollStorage = require("../components/poll/storage");
      const pollsForChat = await pollStorage.findPollsByChat(from);
      if (pollsForChat && pollsForChat.length) {
        const latest = pollsForChat[0];
        const poll = latest.poll;
        const msgId = latest.id;
        const opts = poll.options || poll.optionsList || poll.optionsList || [];
        if (idx >= 0 && idx < opts.length) {
          const voterId = (msg && (msg.author || msg.from)) || String(from);
          await pollStorage.recordVote(msgId, voterId, [idx]);
          // invoke callback if registered
          try {
            const pollsModule = require("../components/poll");
            pollsModule.invokeCallback(msgId, {
              messageId: msgId,
              poll,
              voter: voterId,
              selectedIndexes: [idx],
              selectedNames: [(opts && opts[idx]) || String(idx)],
            });
          } catch (err) {
            logger.debug(
              "Failed to invoke poll callback for numeric vote",
              err && err.message
            );
          }
          // only log vote registration; do not send a chat message
          logger.info("fallback numeric vote", {
            msgId,
            voterId,
            choice: (opts && opts[idx]) || String(idx),
          });
          return;
        }
      }
    }
  } catch (err) {
    // swallow fallback errors
    logger.debug(
      "Erro ao processar fallback numérico de poll",
      err && err.message
    );
  }

  // legacy: simple static ping handler fallback
  if (body.toLowerCase() === "ping") {
    try {
      await reply("pong");
    } catch (err) {
      logger.error("Erro ao enviar resposta:", err);
    }
  }
}

module.exports = { handle };
