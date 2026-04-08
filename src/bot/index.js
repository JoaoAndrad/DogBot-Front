const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode");
const { Client } = require("whatsapp-web.js");
const logger = require("../utils/logger");
const { initSessionOptions } = require("./session");
const qrHelper = require("./qr");

let client = null;

async function start() {
  const auth = initSessionOptions();

  // By default run Puppeteer in headless mode (do not show the browser).
  // To explicitly show the browser set PUPPETEER_HEADLESS=false in env.
  const headless = process.env.PUPPETEER_HEADLESS !== "false";
  const puppeteerOpts = {
    headless: headless,
    args: ["--no-sandbox"],
    timeout: 60000, // Increase timeout to 60 seconds
  };
  // Only add UI-related flags when not headless
  if (!headless) puppeteerOpts.args.push("--start-maximized");

  client = new Client({
    authStrategy: auth,
    puppeteer: puppeteerOpts,
    authTimeoutMs: 60000, // Increase auth timeout to 60 seconds
  });

  client.on("qr", (qr) => {
    qrHelper
      .saveQr(qr)
      .then((p) => {
        logger.info("QR salvo em " + p);
      })
      .catch((err) => {
        logger.error("Erro ao salvar QR:", err);
      });
  });

  // Wrap sendMessage to automatically disable sendSeen and avoid markedUnread errors
  const originalSendMessage = client.sendMessage.bind(client);
  client.sendMessage = async function (chatId, content, options = {}) {
    // Always disable sendSeen to prevent "Cannot read properties of undefined (reading 'markedUnread')" errors
    const mergedOptions = { ...options, sendSeen: false };
    return originalSendMessage(chatId, content, mergedOptions);
  };

  client.on("ready", async () => {
    logger.info("WhatsApp client pronto");

    try {
      const { startRoutineTickLoop } = require("../services/routineTickService");
      startRoutineTickLoop(client, 60000);
      logger.info("[routineTick] loop iniciado (60s)");
    } catch (err) {
      logger.warn("[routineTick] não iniciado:", err && err.message);
    }

    // Initialize workout ranking service
    try {
      const groupRankingService = require("../services/groupRankingService");
      groupRankingService.initialize(client);
      logger.info("Workout ranking service initialized");
    } catch (err) {
      logger.error("Error initializing workout ranking service:", err);
    }

    const config = require("../core/config");
    if (config.enableCatchup) {
      try {
        if (config.catchupDelayMs > 0) {
          await new Promise((r) => setTimeout(r, config.catchupDelayMs));
        }
        const catchup = require("./catchup");
        // Rodar catchup ao iniciar para processar mensagens recebidas enquanto offline
        await catchup.runCatchup(client, { limitPerChat: 200 });
      } catch (err) {
        // Log completo para diagnóstico
        logger.warn("Erro no catchup inicial:", {
          message: err && err.message,
          stack: err && err.stack,
          error: err,
        });
      }
    } else {
      logger.info("Catchup desabilitado pela configuração");
    }
  });

  client.on("message", async (msg) => {
    try {
      const pipeline = require("../pipeline");
      await pipeline.processEvent({ client, msg });
    } catch (err) {
      logger.error("Erro ao processar mensagem:", err);
    }
    // Fallback: detect poll vote messages that may not emit `vote_update`
    try {
      const polls = require("../components/poll");
      const { MessageTypes } = require("whatsapp-web.js");
      const t = msg && msg.type;
      // Only process as poll vote if type is explicitly poll_vote or POLL_VOTE
      // Do NOT use fallback detection to avoid false positives on regular messages
      const isPollVote = t === MessageTypes?.POLL_VOTE || t === "poll_vote";

      if (isPollVote) {
        // Normalize vote object
        const vote = {
          messageId: msg.id && (msg.id._serialized || msg.id.id),
          voter: msg.author || msg.from,
          selectedOptions:
            msg.selectedOptions || msg.pollVote || msg.vote || [],
          message: msg,
        };
        logger.debug("Detected poll vote message via fallback", vote.messageId);
        await polls.handleVoteUpdate(vote);
      }
    } catch (e) {
      // non-fatal
    }
  });

  // listen for poll votes (vote_update) and dispatch to polls handler
  try {
    const polls = require("../components/poll");
    const processor = require("../components/poll/processor");

    // Configure WhatsApp client in poll component for contact resolution
    polls.setWhatsAppClient(client);

    // Register Spotify poll handlers with processor
    const spotifyPollHandlers = require("../commands/spotify/pollHandlers");
    spotifyPollHandlers.registerSpotifyPollHandlers();

    // Validate poll recovery capability
    await processor.restoreAllPolls(client);

    client.on("vote_update", async (vote) => {
      try {
        const voteAccepted = await polls.handleVoteUpdate(vote);

        // Extract poll ID from vote event (same logic as handleVoteUpdate)
        let pollId = null;
        if (vote.parentMsgKey && vote.parentMsgKey._serialized) {
          pollId = vote.parentMsgKey._serialized;
        } else if (vote.parentMsgKey && vote.parentMsgKey.id) {
          pollId = vote.parentMsgKey.id;
        } else if (vote.messageId) {
          pollId = vote.messageId;
        } else if (vote.message && vote.message.id) {
          pollId = vote.message.id;
        } else if (vote.message && vote.message._serialized) {
          pollId = vote.message._serialized;
        } else if (vote && vote._serialized) {
          pollId = vote._serialized;
        } else if (vote && vote.key && vote.key._serialized) {
          pollId = vote.key._serialized;
        } else if (vote && vote.id && vote.remote) {
          const fromMeFlag = vote.fromMe ? "true" : "false";
          pollId = `${fromMeFlag}_${vote.remote}_${vote.id}`;
          if (vote.participant) pollId = `${pollId}_${vote.participant}`;
        }

        // NEW: Process vote through backend instead of local processor
        if (voteAccepted && pollId) {
          await processor.processVoteViaBackend(pollId, vote, client);
        }
      } catch (err) {
        logger.error("Erro ao processar vote_update:", err);
      }
    });
  } catch (err) {
    logger.warn("Módulo polls não encontrado; vote_update não será processado");
  }

  client.on("message_create", async (msg) => {
    try {
      if (msg && msg.type === "poll_vote") {
        logger.debug("Detected poll_vote via message_create", msg.id);
      }
    } catch (e) {
      // non-fatal
    }
  });

  await client.initialize();
  // Start the internal API (delegated to separate module)
  try {
    const { startInternalApi } = require("./internal-api");
    await startInternalApi(client);
  } catch (e) {
    logger.warn("Internal API failed to start (non-fatal)", e && e.message);
  }
  return client;
}

async function stop() {
  try {
    // stop internal API if running
    try {
      const { stopInternalApi } = require("./internal-api");
      await stopInternalApi();
    } catch (e) {}
    if (client) await client.destroy();
    logger.info("Client destruído");
  } catch (err) {
    logger.error("Erro ao parar client:", err);
  }
}

module.exports = { start, stop, client };
