const logger = require("../../utils/logger");
const config = require("../../core/config");
const { allow: rateLimitAllow } = require("../../utils/userRateLimiter");
const storage = require("./storage");
const builder = require("./builder");
const { createSender } = require("./sender");
const EventEmitter = require("events");
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

// in-memory callbacks map: messageId -> callback
const callbacks = new Map();

// WhatsApp client reference for resolving contact IDs
let whatsappClient = null;

// Store handlers for different vote types
const voteHandlers = {};

/**
 * Opções passadas ao whatsapp-web.js Poll(..., optionsObj), persistidas em options_obj.
 */
function getPollOptionsObj(p) {
  if (!p) return {};
  let o = p.options_obj ?? p.optionsObj;
  if (o == null) return {};
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return {};
    }
  }
  return typeof o === "object" && o !== null && !Array.isArray(o) ? o : {};
}

/** Enquete com várias escolhas — o WA dispara vários vote_update; não aplicar o mesmo rate limit de voto único. */
function pollAllowsMultipleAnswers(p) {
  return getPollOptionsObj(p).allowMultipleAnswers === true;
}

/** Texto legível em pt para duração do ban (config.rateLimitBanMs). */
function formatBanDurationPt(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "alguns instantes";
  const sec = Math.ceil(n / 1000);
  if (sec < 60) return `${sec} segundo${sec === 1 ? "" : "s"}`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min} minuto${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  if (remMin === 0) return `${h} hora${h === 1 ? "" : "s"}`;
  return `${h} hora${h === 1 ? "" : "s"} e ${remMin} minuto${remMin === 1 ? "" : "s"}`;
}

/**
 * Aviso no chat quando entra ban unificado (enquetes + comandos), só na transição limit_exceeded no fluxo de voto.
 * Grupo: menção; DM: texto sem @.
 */
async function sendPollAbuseBanNotice(chatId, voterJid, banMs) {
  if (!whatsappClient || !chatId || !voterJid || voterJid === "unknown") {
    return;
  }
  const dur = formatBanDurationPt(banMs);
  const isGroup = String(chatId).endsWith("@g.us");

  if (isGroup) {
    const num = String(voterJid).split("@")[0];
    const body = `⚠️ @${num}, você foi suspenso do uso de enquetes e comandos por ${dur} devido a uso excessivo. Peço que utilize minhas funções com calma para evitar novos bloqueios.`;
    try {
      await whatsappClient.sendMessage(chatId, body, {
        mentions: [voterJid],
      });
    } catch (e) {
      logger.warn("[PollComponent] aviso ban enquetes (mentions JID)", e.message);
      try {
        const contacts = await Promise.all([
          whatsappClient.getContactById(voterJid).catch(() => null),
        ]);
        const valid = contacts.filter(Boolean);
        if (valid.length) {
          await whatsappClient.sendMessage(chatId, body, { mentions: valid });
        } else {
          await whatsappClient.sendMessage(chatId, body);
        }
      } catch (e2) {
        logger.warn("[PollComponent] aviso ban enquetes fallback", e2.message);
      }
    }
    return;
  }

  const bodyDm = `⚠️ Você foi suspenso do uso de enquetes e comandos por ${dur} devido a uso excessivo. Peço que utilize minhas funções com calma para evitar novos bloqueios.`;
  try {
    await whatsappClient.sendMessage(chatId, bodyDm);
  } catch (e) {
    logger.warn("[PollComponent] aviso ban enquetes DM", e.message);
  }
}

function setWhatsAppClient(client) {
  whatsappClient = client;
  logger.info("[PollComponent] Cliente WhatsApp configurado");
}

function registerVoteHandler(voteType, handler) {
  if (voteType && typeof handler === "function") {
    voteHandlers[voteType] = handler;
    logger.info(`[PollComponent] Vote handler registrado para: ${voteType}`);
  } else {
    logger.warn(`[PollComponent] Tentativa de registrar handler inválido: ${voteType}`);
  }
}

async function restoreCallbacksFromDatabase() {
  try {
    logger.info("[PollComponent] Restaurando callbacks de polls ativas...");
    const polls = await storage.listPolls();

    if (!polls || polls.length === 0) {
      logger.info("[PollComponent] Nenhuma poll ativa para restaurar");
      return;
    }

    logger.info(`[PollComponent] Encontradas ${polls.length} polls ativas`);

    let restoredCount = 0;

    for (const poll of polls) {
      const msgId = poll.id;
      const voteType = poll.vote_type || poll.voteType;
      const voteId = poll.vote_id || poll.voteId;

      // Se houver handler registrado para este tipo, restaura o callback
      if (voteType && voteHandlers[voteType]) {
        callbacks.set(msgId, voteHandlers[voteType]);
        restoredCount++;
        logger.info(
          `[PollComponent] Callback restaurado: msgId=${msgId}, voteType=${voteType}`,
        );
      } else if (poll.metadata) {
        // Try to infer voteType from metadata
        const metadata = typeof poll.metadata === 'string' 
          ? JSON.parse(poll.metadata) 
          : poll.metadata;
        
        const inferredType = metadata.queueEntryId 
          ? "spotify_track" 
          : metadata.allTracks 
          ? "spotify_collection" 
          : null;
        
        if (inferredType && voteHandlers[inferredType]) {
          callbacks.set(msgId, voteHandlers[inferredType]);
          restoredCount++;
          logger.info(
            `[PollComponent] Callback restaurado (inferido): msgId=${msgId}, voteType=${inferredType}`,
          );
        }
      }
    }

    logger.info(
      `[PollComponent] Callbacks restaurados: ${restoredCount}/${polls.length} polls`,
    );
  } catch (err) {
    logger.error(`[PollComponent] Erro ao restaurar callbacks: ${err.message}`);
  }
}

function registerCallback(msgId, cb) {
  if (!msgId || typeof cb !== "function") return false;
  callbacks.set(msgId, cb);
  return true;
}

async function saveFallbackPoll(chatId, title, options, opts = {}) {
  const msgId = `fallback_${Date.now()}`;
  const normTitle =
    title && String(title).normalize ? String(title).normalize("NFC") : title;
  const normOptions = Array.isArray(options)
    ? options.map((o) =>
        o && String(o).normalize ? String(o).normalize("NFC") : o,
      )
    : [];
  const record = {
    type: "fallback",
    chatId,
    title: normTitle,
    options: normOptions.slice(),
    pollOptions: normOptions.map((o, i) => ({ name: o, localId: i })),
    optionsObj: opts.options || {},
    createdAt: Date.now(),
  };
  await storage.savePoll(msgId, record);
  return msgId;
}

function invokeCallback(msgId, data) {
  const cb = callbacks.get(msgId);
  if (cb) {
    try {
      cb(data);
    } catch (err) {
      logger.error("Error invoking poll callback", err);
    }
  }
}

/**
 * Facade: build -> send -> persist -> register callback
 * Signature supports either passing a `client` as first arg (legacy) or an injected `sender` via opts.sender.
 * createPoll(clientOrSender, chatId, title, options, opts={})
 */
async function createPoll(clientOrSender, chatId, title, options, opts = {}) {
  // allow calling createPoll(chatId, title, options, opts) by shifting args if clientOrSender looks like chatId
  let sender = null;
  let effectiveChatId = chatId;
  if (typeof clientOrSender === "string" && !chatId) {
    throw new Error("Invalid arguments: missing client/sender");
  }

  // If opts.sender provided, use it (DI)
  if (opts && opts.sender) sender = opts.sender;
  else if (clientOrSender && typeof clientOrSender.sendPoll === "function")
    sender = clientOrSender;
  else if (clientOrSender && typeof clientOrSender.sendMessage === "function")
    sender = createSender(clientOrSender);
  else throw new Error("No sender or client provided to createPoll");

  // Build payload (validates and normalizes)
  const payload = builder.buildPollPayload(chatId, title, options, opts);

  // Send
  const sendResult = await sender.sendPoll(payload, opts);
  if (!sendResult) {
    // Always log this, even for confissão polls — it means the poll was not sent
    console.error(`[createPoll] sendResult null — poll não foi enviado. title="${payload.title}" chatId="${payload.chatId}"`);
    return null;
  }

  const { msgId, sent, type, pollOptions } = sendResult;

  // persist
  const record = {
    type: type || "native",
    chatId: payload.chatId,
    title: payload.title,
    options: payload.options,
    pollOptions:
      pollOptions || payload.options.map((o, i) => ({ name: o, localId: i })),
    optionsObj: payload.optionsObj || {},
    voteType: opts.voteType || null,
    voteId: opts.voteId || null,
    groupId: opts.groupId || null,
    metadata: opts.metadata || null,
    createdAt: Date.now(),
  };

  const isConfissaoPoll = payload.title && /confiss[aã]o/i.test(payload.title);

  if (!isConfissaoPoll) {
    console.log("[createPoll] Saving poll with msgId:", msgId);
  }
  try {
    await storage.savePoll(msgId, record);
    if (!isConfissaoPoll) {
      console.log("[createPoll] Poll saved successfully:", msgId);
    }
  } catch (err) {
    console.error("[createPoll] Failed to save poll:", err.message);
    throw err;
  }

  // register callback
  if (typeof opts.onVote === "function") callbacks.set(msgId, opts.onVote);

  if (!isConfissaoPoll) {
    logger.info("Poll enviada", {
      chatId: payload.chatId,
      msgId,
      title: payload.title,
    });
  }
  return { sent, msgId };
}

/**
 * @returns {Promise<boolean>} true se o voto foi aceite e processado; false se ignorado (ex.: rate limit, enquete desconhecida)
 */
async function handleVoteUpdate(vote) {
  try {
    //logger.debug("vote_update recebido", vote);
    let messageId = null;

    // Try parentMsgKey first (most reliable for poll votes)
    if (vote.parentMsgKey && vote.parentMsgKey._serialized) {
      messageId = vote.parentMsgKey._serialized;
    } else if (vote.parentMsgKey && vote.parentMsgKey.id) {
      messageId = vote.parentMsgKey.id;
    } else if (vote.messageId) {
      messageId = vote.messageId;
    } else if (vote.message && vote.message.id) {
      messageId = vote.message.id;
    } else if (vote.message && vote.message._serialized) {
      messageId = vote.message._serialized;
    } else if (vote && vote._serialized) {
      messageId = vote._serialized;
    } else if (vote && vote.key && vote.key._serialized) {
      messageId = vote.key._serialized;
    } else if (vote && vote.id && vote.remote) {
      const fromMeFlag = vote.fromMe ? "true" : "false";
      messageId = `${fromMeFlag}_${vote.remote}_${vote.id}`;
      if (vote.participant) messageId = `${messageId}_${vote.participant}`;
    }

    if (!messageId) {
      logger.debug("vote_update sem messageId — ignorando");
      return false;
    }

    // Try direct lookup first
    let poll = await storage.getPoll(messageId);

    // Check if it's a confissão poll to skip logs
    let isConfissaoPoll =
      poll && poll.title && /confiss[aã]o/i.test(poll.title);

    if (!isConfissaoPoll) {
      console.log(
        "[handleVoteUpdate] Direct lookup result:",
        poll ? "found" : "not found",
        "for msgId:",
        messageId,
      );
    }

    // If not found and we have parentMsgKey with id parts, try to find by matching
    if (
      !poll &&
      vote.parentMsgKey &&
      vote.parentMsgKey.id &&
      vote.parentMsgKey.remote
    ) {
      if (!isConfissaoPoll) {
        console.log(
          "[handleVoteUpdate] Trying to find poll by chat_id:",
          vote.parentMsgKey.remote,
        );
      }
      try {
        const allPolls = await storage.listPolls();
        if (!isConfissaoPoll) {
          console.log(
            "[handleVoteUpdate] Found",
            allPolls.length,
            "total polls",
          );
        }

        // Try to match by chat_id only - get most recent poll from this chat
        const pollsInChat = allPolls.filter(
          (p) => p.chat_id === vote.parentMsgKey.remote,
        );

        // Update isConfissaoPoll based on found polls
        const foundConfissao = pollsInChat.some(
          (p) => p.title && /confiss[aã]o/i.test(p.title),
        );

        if (!foundConfissao) {
          console.log(
            "[handleVoteUpdate] Found",
            pollsInChat.length,
            "polls in chat:",
            vote.parentMsgKey.remote,
          );
        }

        if (pollsInChat.length > 0) {
          // Get most recent poll
          const sorted = pollsInChat.sort((a, b) => {
            const timeA = new Date(a.created_at || 0).getTime();
            const timeB = new Date(b.created_at || 0).getTime();
            return timeB - timeA; // descending
          });
          poll = sorted[0];
          messageId = poll.id;

          const isPollConfissao =
            poll.title && /confiss[aã]o/i.test(poll.title);
          if (!isPollConfissao) {
            console.log(
              "[handleVoteUpdate] Using most recent poll from chat:",
              messageId,
              "title:",
              poll.title,
            );
          }
        }
      } catch (err) {
        console.log(
          "[handleVoteUpdate] Failed to search polls for match",
          err.message,
        );
      }
    }

    if (!poll) {
      logger.debug("vote_update para enquete desconhecida", messageId);
      return false;
    }

    // Extract raw voter ID from vote event
    let voter =
      vote.voter ||
      vote.voterId ||
      (vote.author && vote.author.id) ||
      (vote.voter && vote.voter._serialized) ||
      "unknown";

    // Try to resolve voter to @c.us format using getContact()
    // IMPORTANTE: getContactById() resolve @lid para o número real @c.us
    if (whatsappClient && voter && voter !== "unknown") {
      try {
        // Use voter diretamente - getContactById() resolve @lid automaticamente
        const contact = await whatsappClient.getContactById(voter);
        if (contact && contact.id && contact.id._serialized) {
          const resolvedVoter = contact.id._serialized;
          // Only log if not a confissão poll
          if (!isConfissaoPoll) {
            logger.debug(
              `[PollComponent] Voter resolvido: ${voter} → ${resolvedVoter}`,
            );
          }
          voter = resolvedVoter;
        }
      } catch (err) {
        if (!isConfissaoPoll) {
          logger.debug(
            `[PollComponent] Não foi possível resolver voter ${voter}:`,
            err.message,
          );
        }
        // Keep original voter if resolution fails
      }
    }

    if (config.rateLimitEnabled && !pollAllowsMultipleAnswers(poll)) {
      const r = rateLimitAllow(`poll:${voter}`, {
        maxEvents: config.rateLimitPollVoteMax,
        windowMs: config.rateLimitPollVoteWindowMs,
        banMs: config.rateLimitBanMs,
        banKey: `rl:${voter}`,
      });
      if (!r.ok) {
        logger.debug(
          `[rateLimit] voto em enquete bloqueado (${r.reason}): ${voter}`,
        );
        if (r.reason === "limit_exceeded") {
          const noticeChatId =
            poll.chat_id ||
            poll.chatId ||
            (vote.parentMsgKey && vote.parentMsgKey.remote) ||
            null;
          if (noticeChatId) {
            await sendPollAbuseBanNotice(
              noticeChatId,
              voter,
              config.rateLimitBanMs,
            );
          }
        }
        return false;
      }
    }

    const selectedOptions =
      vote.selectedOptions || vote.selected || vote.selectedOptionIndexes || [];

    let rawSelected = selectedOptions;
    let selectedIndexes = [];
    let selectedNames = [];
    const storedPoll = poll || (await storage.getPoll(messageId));
    const optsArr =
      storedPoll &&
      (storedPoll.pollOptions ||
        (storedPoll.options &&
          storedPoll.options.map((o, i) => ({ name: o, localId: i }))));

    if (Array.isArray(rawSelected) && rawSelected.length) {
      if (typeof rawSelected[0] === "object") {
        for (const s of rawSelected) {
          const lid = s.localId != null ? s.localId : s.local_id || null;
          const name = s.name || s.option || null;
          if (lid != null) {
            selectedIndexes.push(Number(lid));
            const opt =
              optsArr && optsArr.find((o) => o.localId === Number(lid));
            selectedNames.push(opt ? opt.name : name || String(lid));
          } else if (name) {
            const idx = optsArr && optsArr.findIndex((o) => o.name === name);
            if (idx != null && idx >= 0) {
              selectedIndexes.push(idx);
              selectedNames.push(name);
            } else {
              selectedNames.push(name);
            }
          }
        }
      } else {
        selectedIndexes = rawSelected.map((n) => Number(n));
        selectedNames = selectedIndexes.map(
          (i) => (optsArr && optsArr[i] && optsArr[i].name) || String(i),
        );
      }
    }

    await storage.recordVote(
      messageId,
      voter,
      rawSelected,
      selectedIndexes,
      selectedNames,
    );

    // Log resumido do voto (skip if confissão poll)
    const voterName = (voter && voter.split("@")[0]) || "unknown";
    const pollTitle = (storedPoll && storedPoll.title) || "Poll";
    isConfissaoPoll = pollTitle && /confiss[aã]o/i.test(pollTitle);

    if (!isConfissaoPoll) {
      console.log(
        `🗳️ Voto | ${pollTitle} | 👤 ${voterName} | ✅ ${selectedNames.join(
          ", ",
        )}`,
      );
    }

    const payload = {
      messageId,
      poll: storedPoll,
      voter,
      selectedIndexes,
      selectedNames,
      raw: vote,
    };

    // emit global and per-message events
    try {
      emitter.emit("vote", payload);
      emitter.emit(`vote:${messageId}`, payload);
    } catch (e) {
      logger.error("Erro ao emitir evento de vote", e);
    }

    const cb = callbacks.get(messageId);
    if (cb) {
      try {
        await cb(payload);
      } catch (err) {
        logger.error("Erro no callback de vote for poll", err);
      }
    } else if (storedPoll && (storedPoll.voteId || storedPoll.vote_id)) {
      // Fallback: If callback not in memory but we have voteId (e.g., after bot restart),
      // send vote directly to backend
      logger.info(
        `[PollComponent] Callback não encontrado em memória, enviando voto ao backend`,
      );
      try {
        const backendClient = require("../../services/backendClient");
        const voteId = storedPoll.voteId || storedPoll.vote_id;

        // Determine isFor based on selectedIndexes (0 = Yes/Sim)
        const isFor = selectedIndexes && selectedIndexes.includes(0);

        await backendClient.sendToBackend(`/api/groups/votes/${voteId}/cast`, {
          userId: voter,
          isFor,
          pollId: messageId,
        });

        logger.info(`[PollComponent] Voto enviado ao backend: ${voteId}`);
      } catch (err) {
        logger.error(
          "[PollComponent] Erro ao enviar voto ao backend:",
          err.message,
        );
      }
    }

    return true;
  } catch (err) {
    logger.error("Erro ao handleVoteUpdate", err);
    return false;
  }
}

function on(event, cb) {
  return emitter.on(event, cb);
}

function off(event, cb) {
  return emitter.off(event, cb);
}

function once(event, cb) {
  return emitter.once(event, cb);
}

module.exports = {
  createPoll,
  handleVoteUpdate,
  on,
  off,
  once,
  setWhatsAppClient,
  registerVoteHandler,
  restoreCallbacksFromDatabase,
};
module.exports.registerCallback = registerCallback;
module.exports.saveFallbackPoll = saveFallbackPoll;
module.exports.invokeCallback = invokeCallback;

/**
 * Convenience helper: ask a Yes/No question using native poll UI.
 * Signature mirrors `createPoll(clientOrSender, chatId, title, options, opts)`
 * Returns the same result as `createPoll` ({ sent, msgId }) or null on failure.
 */
async function askYesNo(clientOrSender, chatId, question, opts = {}) {
  const options = opts.options || ["Sim", "Não"];
  const effectiveOpts = Object.assign({}, opts, {
    origin: opts.origin || "askYesNo",
  });
  return createPoll(clientOrSender, chatId, question, options, effectiveOpts);
}

module.exports.askYesNo = askYesNo;
