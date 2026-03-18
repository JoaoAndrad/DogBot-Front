const logger = require("../utils/logger");
const commands = require("../commands");
const backendClient = require("../services/backendClient");
const spotifyService = require("../services/spotifyService");
const conversationState = require("../services/conversationState");
const botMetricsReporter = require("../services/botMetricsReporter");
const { handleCadastroFlow } = require("./cadastroFlowHandler");
const { handleMetaFlow } = require("./metaFlowHandler");
const { handleListFlow } = require("./listFlowHandler");
const { handleAddFilmFlow } = require("./addFilmFlowHandler");
const mediaHelper = require("../utils/mediaHelper");
const stickerHelper = require("../utils/stickerHelper");

async function handle(context) {
  // Accept either context.info (legacy) or context.msg (whatsapp-web.js)
  const info = context.info || {};
  const msg = context.msg || {};
  const body = String(
    info.body || msg.body || (msg._data && msg._data.caption) || "",
  ).trim();
  const from = info.from || msg.from;

  // robust group detection: prefer explicit flags, but also consider
  // presence of `msg.author` or chat id suffix '@g.us'
  const isGroup = !!(
    (msg && (msg.isGroup || msg.author)) ||
    info.is_group ||
    (from && String(from).endsWith("@g.us"))
  );

  // Log de todas as mensagens recebidas
  try {
    // Skip logging for /confissao command messages
    const isConfissao = body && /^\s*\/?confiss[aã]o\b/i.test(body);

    if (!isConfissao) {
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
    }
  } catch (err) {
    // Silent fail on logging error
  }

  // Note: No longer auto-creating users on regular messages
  // Users must explicitly register with /cadastro command

  // Sticker trigger: any image whose caption/body contains keywords
  try {
    const KEYWORDS = ["figurinha", "sticker", "fig"];
    const normalizedLower = String(body || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const containsKeyword = KEYWORDS.some((k) => normalizedLower.includes(k));

    if (containsKeyword) {
      // Determine target message that contains the image: prefer quoted message's media
      let targetMessage = null;
      try {
        // Try to resolve quoted message via helper if available
        if (msg && typeof msg.getQuotedMessage === "function") {
          try {
            const quoted = await msg.getQuotedMessage().catch(() => null);
            if (quoted) {
              const qMedia = await mediaHelper.obterMidiaDaMensagem(quoted);
              if (qMedia) targetMessage = quoted;
            }
          } catch (e) {
            // ignore
          }
        }

        // Fallback: check contextInfo.quotedMessage
        if (
          !targetMessage &&
          msg &&
          msg._data &&
          msg._data.contextInfo &&
          msg._data.contextInfo.quotedMessage
        ) {
          const quoted = msg._data.contextInfo.quotedMessage;
          const qMedia = await mediaHelper.obterMidiaDaMensagem(quoted);
          if (qMedia) targetMessage = quoted;
        }

        // If no quoted media, and this message has media, use this message
        if (!targetMessage) {
          const thisMedia = await mediaHelper.obterMidiaDaMensagem(msg);
          if (thisMedia) targetMessage = msg;
        }

        if (targetMessage) {
          const media = await mediaHelper.obterMidiaDaMensagem(targetMessage);
          if (media && media.buffer) {
            // Reject animated gifs or animated webp
            const mimetype = (media.mimetype || "").toLowerCase();
            const isGif = mimetype.includes("gif");
            const buf = media.buffer;
            let isAnimatedWebp = false;
            try {
              if (
                Buffer.isBuffer(buf) &&
                buf.indexOf(Buffer.from("ANIM")) !== -1
              )
                isAnimatedWebp = true;
            } catch (e) {
              isAnimatedWebp = false;
            }

            if (isGif || isAnimatedWebp) {
              try {
                await reply(
                  "Desculpe, figurinhas animadas não são suportadas.",
                );
              } catch (e) {}
              return;
            }

            // Reject very large files (>5MB)
            if (media.filesize && media.filesize > 5 * 1024 * 1024) {
              try {
                await reply(
                  "Arquivo muito grande para converter em figurinha (limite 5MB).",
                );
              } catch (e) {}
              return;
            }

            // Send sticker quoting the original image message (targetMessage)
            try {
              const ok = await stickerHelper.sendBufferAsSticker(
                context.client,
                from,
                media.buffer,
                {
                  filename: media.filename || "sticker.webp",
                  quoted: targetMessage,
                },
              );
              if (ok) {
                botMetricsReporter
                  .reportEvent("sticker_created", {
                    chatId: from,
                    fromId: (msg && (msg.author || msg.from)) || from,
                    chatName: context.chatName || undefined,
                    isGroup: context.isGroup,
                  })
                  .catch(() => {});
              }
              if (!ok) {
                try {
                  await reply(
                    "Não consegui enviar a figurinha, tente novamente mais tarde.",
                  );
                } catch (e) {}
              }
              return; // end processing after sticker
            } catch (e) {
              logger.error(
                "[stickerHandler] error sending sticker:",
                e && e.message,
              );
            }
          }
        }
      } catch (err) {
        logger.debug(
          "[stickerHandler] failed to process sticker trigger:",
          err && err.message,
        );
      }
    }
  } catch (err) {
    logger.debug("[stickerHandler] top-level error:", err && err.message);
  }

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
      `[Handler] Fluxo ativo detectado para ${actualNumber}: ${state.flowType}`,
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

    if (state.flowType === "meta") {
      return await handleMetaFlow(actualNumber, body, state, reply, {
        author,
        isGroup,
        from,
        pushName: (msg && msg._data && msg._data.notifyName) || info.pushName,
        client: context.client,
      });
    }

    if (state.flowType === "list-creation") {
      return await handleListFlow(actualNumber, body, state, reply, {
        author,
        isGroup,
        from,
        pushName: (msg && msg._data && msg._data.notifyName) || info.pushName,
        client: context.client,
        message: msg,
      });
    }

    if (state.flowType === "add-film") {
      return await handleAddFilmFlow(actualNumber, body, state, reply, {
        author,
        isGroup,
        from,
        pushName: (msg && msg._data && msg._data.notifyName) || info.pushName,
        client: context.client,
        message: msg,
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

  // Auto-reply in groups when message mentions 'pix'
  try {
    const normalized = String(body || "")
      .normalize("NFD")
      .replace(/[ -]/g, (c) => c)
      .toLowerCase();
    // simple substring check for 'pix'
    if (isGroup && normalized.includes("pix")) {
      try {
        const styled =
          "Opa! Alguém disse pix? 👋\n\n" +
          "Que bom que você mostrou interesse em ajudar com os custos de manutenção do DogBot. 🐶\n" +
          "Segue nossa chave PIX:\n\n" +
          "pixdeandrade@gmail.com\n\n" +
          "Banco: C6 Bank 🏦\n\n" +
          "Agradecemos muito pelo apoio! 🐾";

        await reply(styled);
      } catch (e) {
        logger.debug("failed to send pix auto-reply", e && e.message);
      }
    }
  } catch (e) {
    logger.debug("pix auto-reply check failed", e && e.message);
  }

  // Auto-detect workout registration: bot mention + "treinei"
  try {
    // Check if bot was mentioned and message contains "treinei"
    const containsTreinei = /\btreinei\b/i.test(body);

    // Debug: log mention detection
    if (containsTreinei && isGroup) {
      console.log("[workoutHandler] Detected 'treinei' in group message");
      console.log("[workoutHandler] msg.mentionedIds:", msg.mentionedIds);
      console.log(
        "[workoutHandler] client.info.wid:",
        context.client?.info?.wid?._serialized,
      );
    }

    // Resolve mentioned IDs (handles @lid, @c.us, etc.)
    let botWasMentioned = false;
    if (msg.mentionedIds && Array.isArray(msg.mentionedIds) && context.client) {
      const botId = context.client.info?.wid?._serialized;

      for (const mentionedId of msg.mentionedIds) {
        try {
          // Resolve @lid to real @c.us using getContactById
          const contact = await context.client.getContactById(mentionedId);
          const resolvedId = contact?.id?._serialized || mentionedId;

          console.log(
            `[workoutHandler] Resolved: ${mentionedId} → ${resolvedId}`,
          );

          if (resolvedId === botId) {
            botWasMentioned = true;
            break;
          }
        } catch (err) {
          // Fallback to direct comparison if resolve fails
          if (mentionedId === botId) {
            botWasMentioned = true;
            break;
          }
        }
      }
    }

    if (isGroup && botWasMentioned && containsTreinei) {
      // Verificar se o grupo tem treinos ativados
      let groupWorkoutEnabled = false;
      try {
        const groupSettings = await backendClient.sendToBackend(
          `/api/workouts/groups/${encodeURIComponent(from)}/settings`,
          null,
          "GET",
        );
        groupWorkoutEnabled = !!(
          groupSettings && groupSettings.workoutTrackingEnabled
        );
      } catch (err) {
        logger.warn(
          `[workoutHandler] Could not verify group settings for ${from}:`,
          err?.message,
        );
      }

      if (!groupWorkoutEnabled) {
        logger.info(
          `[workoutHandler] Group ${from} does not have workout tracking enabled, ignoring treinei mention.`,
        );
      } else
        try {
          const author = msg.author || msg.from || info.from;

          // Resolve author @lid to real @c.us
          let senderNumber = null;
          let displayName = null;
          try {
            const contact = await context.client.getContactById(author);
            const resolvedAuthor = contact?.id?._serialized || author;
            senderNumber = resolvedAuthor.replace(/@c\.us$/i, "");
            displayName =
              contact?.pushname || contact?.name || contact?.notify || null;
            console.log(
              `[workoutHandler] Author resolved: ${author} → ${resolvedAuthor} → ${senderNumber} (${displayName})`,
            );
          } catch (err) {
            // Fallback to original author
            senderNumber = author.replace(/@(c\.us|lid)$/i, "");
            console.log(
              `[workoutHandler] Author fallback: ${author} → ${senderNumber}`,
            );
          }

          // Extract note: remove bot mention and "treinei" word
          const note =
            body
              .replace(/@\d+/g, "") // Remove mentions
              .replace(/\btreinei\b/i, "") // Remove "treinei"
              .trim() || null;

          logger.info(
            `[workoutHandler] Processing workout for ${senderNumber} in ${from}`,
          );

          // Send to backend
          const workoutNotificationService = require("../services/workoutNotificationService");
          const groupRankingService = require("../services/groupRankingService");

          const result = await backendClient.sendToBackend(
            "/api/workouts/log",
            {
              senderNumber,
              chatId: from,
              messageId: msg.id?._serialized,
              note,
              loggedAt: new Date().toISOString(),
            },
            "POST",
          );

          if (result.success) {
            if (isGroup) {
              await msg.reply(result.message || "🔥 Treino registrado!");
            }

            // Notify other groups
            await workoutNotificationService.notifyWorkoutToGroups(
              context.client,
              senderNumber,
              result.stats,
              from, // Exclude current group
              displayName, // Pass displayName
            );

            // Ask user in private whether to add this workout to their other groups
            try {
              const multiGroup = require("../services/workoutMultiGroupService");
              multiGroup
                .askUserAboutOtherGroups(
                  context.client,
                  senderNumber,
                  result.stats,
                  from,
                  displayName,
                  note,
                  new Date().toISOString(),
                )
                .catch((err) =>
                  logger.error(
                    "[workoutHandler] multiGroup error:",
                    err && err.message,
                  ),
                );
            } catch (e) {
              logger.error(
                "[workoutHandler] failed to start multiGroup flow",
                e && e.message,
              );
            }

            // Update ranking in group where logged
            setTimeout(async () => {
              try {
                await groupRankingService.updateGroupRanking(from);
              } catch (err) {
                logger.error("[workoutHandler] Error updating ranking:", err);
              }
            }, 1000);
          } else if (result.error === "workout_already_logged_today") {
            await msg.reply("Você já registrou treino hoje! 💪");
          }
        } catch (err) {
          logger.error("[workoutHandler] Error processing workout:", err);
        }
    }
  } catch (e) {
    logger.debug("workout auto-detect check failed", e && e.message);
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
    // Special case: "confissao" works without prefix only in private chats
    const raw = body.split(/\s+/)[0];
    const normalized = normalizeCmdName(raw);

    if (normalized === "confissao" && !isGroup) {
      // Allow "confissao" without prefix in private chats
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

        // Check if it's confissao command to skip debug logs
        const isConfissao = body && /^\s*\/?confiss[aã]o\b/i.test(body);

        // Try to get actual phone number from contact
        let actualNumber = null;
        try {
          const contact = await msg.getContact();
          if (contact && contact.id && contact.id._serialized) {
            actualNumber = contact.id._serialized;
            if (!isConfissao) {
              logger.debug(`[Handler] Número do contato: ${actualNumber}`);
            }
          }
        } catch (err) {
          if (!isConfissao) {
            logger.debug(`[Handler] Erro ao buscar contato:`, err.message);
          }
        }

        // Fallback: use from/author if contact fetch failed
        if (!actualNumber) {
          if (!isGroup) {
            actualNumber = from;
          } else {
            actualNumber = author ? author.replace(/@lid$/i, "") : null;
          }
          if (!isConfissao) {
            logger.debug(`[Handler] Usando fallback: ${actualNumber}`);
          }
        }

        if (actualNumber) {
          if (!isConfissao) {
            logger.debug(
              `[Handler] Verificando cadastro para: ${actualNumber}`,
            );
          }
          const lookupRes = await backendClient.sendToBackend(
            `/api/users/lookup?identifier=${encodeURIComponent(actualNumber)}`,
            null,
            "GET",
          );

          if (!isConfissao) {
            logger.debug(`[Handler] Resultado lookup:`, lookupRes);
          }

          if (!lookupRes || !lookupRes.found) {
            if (isGroup) {
              await reply(
                "hmmm parece que não te conheço... venha no meu privado e digite /cadastro",
              );
            } else {
              await reply(
                "É necessário enviar /cadastro no privado antes de utilizar qualquer comando",
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

    // Extract command arguments
    const commandPrefix = body.startsWith("!") || body.startsWith("/") ? 1 : 0;
    const parts = body.slice(commandPrefix).trim().split(/\s+/);
    const args = parts.slice(1); // Skip command name, keep rest as args

    const ctx = {
      message: msg,
      info,
      client: context.client,
      reply,
      args,
      services: { backend: backendClient, spotify: spotifyService },
    };

    botMetricsReporter
      .reportEvent("command", {
        commandName: "/" + cmdName,
        chatId: from,
        fromId: actualNumber || author || from,
        chatName: context.chatName || undefined,
        isGroup: context.isGroup,
      })
      .catch(() => {});

    try {
      await cmd.execute(ctx);
    } catch (err) {
      try {
        const stack = err && err.stack ? err.stack : JSON.stringify(err);
        logger.error(`Erro ao executar comando ${cmdName}: ${stack}`);
      } catch (logErr) {
        logger.error("Erro ao executar comando (e falha ao logar stack):", err);
      }
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
              err && err.message,
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
      err && err.message,
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
