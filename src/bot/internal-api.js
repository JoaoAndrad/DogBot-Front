const express = require("express");
const logger = require("../utils/logger");
const bootLog = require("../lib/bootLog");
const { loadIgnoredChats, addToIgnoredChats } = require("../utils/chatCleaner");
const { syncSharedChatsToBackend } = require("../services/companionChatSync");

let server = null;
let appInstance = null;

function getGatewaySecret() {
  return (
    process.env.BOT_GATEWAY_SECRET ||
    process.env.POLL_SHARED_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    ""
  );
}

function gatewayAuth(req, res, next) {
  const secret = getGatewaySecret();
  if (!secret) {
    return res.status(503).json({
      ok: false,
      error: "gateway_secret_not_configured",
    });
  }
  const authHeader = req.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const incoming =
    req.get("x-bot-gateway-secret") || req.get("x-internal-secret") || bearer;
  if (incoming !== secret) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  next();
}

function buildSimulatedMessage(client, { text, chatId, authorJid, fromApp }) {
  const cid = String(chatId || "").trim();
  if (!cid) return null;
  const isGroup = cid.endsWith("@g.us");
  const author =
    isGroup && authorJid
      ? String(authorJid).trim()
      : isGroup
        ? null
        : cid.endsWith("@c.us") || cid.endsWith("@s.whatsapp.net")
          ? cid
          : null;

  const simId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const bodyText = String(text || "").trim();

  const msg = {
    id: { _serialized: simId },
    from: cid,
    body: bodyText,
    type: "chat",
    timestamp: Math.floor(Date.now() / 1000),
    isGroup,
    author: author || undefined,
    fromApp: Boolean(fromApp),
    _data: { from: cid, body: bodyText },
    getChat: async () => {
      try {
        if (client && typeof client.getChatById === "function") {
          return await client.getChatById(cid);
        }
      } catch (e) {
        /* ignore */
      }
      return { id: cid, name: null };
    },
  };
  return msg;
}

function createApp(client) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "dogbot-gateway" });
  });
  app.get("/v1/health", (_req, res) => {
    res.json({ ok: true, service: "dogbot-gateway", version: 1 });
  });

  const router = express.Router();
  router.use(gatewayAuth);

  router.get("/internal/whatsapp-status", (_req, res) => {
    const info = client && client.info;
    const whatsappReady = Boolean(info);
    let phone = null;
    try {
      if (info && info.wid && info.wid.user != null) {
        phone = String(info.wid.user);
      }
    } catch (e) {
      /* ignore */
    }
    res.json({ ok: true, whatsappReady, phone });
  });

  router.post("/internal/send-poll", async (req, res) => {
    try {
      const data = req.body || {};
      const chatId = data.chatId || data.to;
      const title = data.title || data.question || data.q;
      const options = Array.isArray(data.options)
        ? data.options
        : data.choices || data.opts || [];

      if (!chatId || !title || !options.length) {
        return res.status(400).json({
          ok: false,
          error: "Missing chatId/title/options",
        });
      }

      const polls = require("../components/poll");
      const result = await polls.createPoll(client, chatId, title, options, {
        onVote: async ({
          messageId,
          poll,
          voter,
          selectedIndexes,
          selectedNames,
        }) => {
          const opts =
            poll &&
            (poll.options ||
              (poll.pollOptions && poll.pollOptions.map((o) => o.name)));
          const chosen =
            (selectedNames && selectedNames[0]) ||
            (selectedIndexes &&
              selectedIndexes[0] != null &&
              opts &&
              opts[selectedIndexes[0]]) ||
            null;
          console.log("internal-api: poll onVote", {
            messageId,
            voter,
            chosen,
            selectedIndexes,
            selectedNames,
          });
        },
      });

      res.json({ ok: true, result });
    } catch (err) {
      const errMsg = err && (err.stack || err.message || String(err));
      console.log("Internal API createPoll failed", errMsg);
      res.status(500).json({ ok: false, error: errMsg });
    }
  });

  router.post("/internal/send-message", async (req, res) => {
    try {
      const data = req.body || {};
      const chatId = data.chatId;
      const message = data.message;

      if (!chatId || !message) {
        return res.status(400).json({
          ok: false,
          error: "Missing chatId or message",
        });
      }

      await client.sendMessage(chatId, message);
      res.json({ ok: true });
    } catch (err) {
      const errMsg = err && (err.stack || err.message || String(err));
      console.log("Internal API send-message failed", errMsg);
      res.status(500).json({ ok: false, error: errMsg });
    }
  });

  router.post("/v1/simulate-command", async (req, res) => {
    const timeoutMs = Number(process.env.SIMULATE_COMMAND_TIMEOUT_MS || 120000);
    try {
      const { text, chatId, authorJid, fromApp } = req.body || {};
      const cid = String(chatId || "").trim();
      if (!cid) {
        return res.status(400).json({ ok: false, error: "missing_chatId" });
      }
      if (cid.endsWith("@g.us") && !authorJid) {
        return res.status(400).json({
          ok: false,
          error: "missing_authorJid_for_group",
        });
      }

      const msg = buildSimulatedMessage(client, {
        text,
        chatId: cid,
        authorJid,
        fromApp,
      });
      if (!msg) {
        return res.status(400).json({ ok: false, error: "invalid_message" });
      }

      const pipeline = require("../pipeline");
      const run = pipeline.processEvent({ client, msg });
      const raced = await Promise.race([
        run,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("simulate_command_timeout")),
            timeoutMs,
          ),
        ),
      ]);

      res.json({
        ok: true,
        processed: raced === true,
      });
    } catch (err) {
      const msg = err && err.message;
      if (msg === "simulate_command_timeout") {
        return res.status(504).json({ ok: false, error: "timeout" });
      }
      logger.error("simulate-command error", err);
      res.status(500).json({
        ok: false,
        error: err && (err.message || String(err)),
      });
    }
  });

  router.get("/internal/bot-groups", async (_req, res) => {
    try {
      const ignored = loadIgnoredChats();
      const chats = await client.getChats();
      const groups = [];
      for (const chat of chats) {
        try {
          if (!chat || !chat.isGroup) continue;
          const chatId = chat.id && chat.id._serialized;
          if (!chatId || !String(chatId).endsWith("@g.us")) continue;
          let name =
            chat.name != null && String(chat.name).trim()
              ? String(chat.name).trim()
              : null;
          if (!name && chat.groupMetadata && chat.groupMetadata.subject) {
            name = String(chat.groupMetadata.subject).trim() || null;
          }
          let participantsCount = 0;
          try {
            participantsCount = Array.isArray(chat.participants)
              ? chat.participants.length
              : 0;
          } catch (_) {
            /* ignore */
          }
          groups.push({
            chatId,
            name,
            participantsCount,
            ignored: ignored.has(chatId),
          });
        } catch (e) {
          logger.debug(
            "[internal/bot-groups] skip chat",
            e && e.message ? e.message : e,
          );
        }
      }
      res.json({ ok: true, groups });
    } catch (err) {
      const errMsg = err && (err.stack || err.message || String(err));
      logger.error("[internal/bot-groups] GET failed", errMsg);
      res.status(500).json({ ok: false, error: errMsg });
    }
  });

  router.post("/internal/bot-groups/leave", async (req, res) => {
    const chatId = String((req.body || {}).chatId || "").trim();
    if (!chatId || !chatId.endsWith("@g.us")) {
      return res.status(400).json({ ok: false, error: "invalid_chatId" });
    }
    try {
      const chat = await client.getChatById(chatId);
      if (!chat) {
        return res.status(404).json({ ok: false, error: "chat_not_found" });
      }
      if (!chat.isGroup) {
        return res.status(400).json({ ok: false, error: "not_a_group" });
      }
      if (typeof chat.leave !== "function") {
        return res.status(500).json({ ok: false, error: "leave_unavailable" });
      }
      await chat.leave();
      try {
        await syncSharedChatsToBackend(client);
      } catch (syncErr) {
        logger.warn(
          "[internal/bot-groups/leave] sync companion:",
          syncErr && syncErr.message ? syncErr.message : syncErr,
        );
      }
      res.json({ ok: true });
    } catch (err) {
      const errMsg = err && (err.message || String(err));
      logger.error("[internal/bot-groups/leave]", errMsg);
      res.status(500).json({ ok: false, error: errMsg });
    }
  });

  router.post("/internal/bot-groups/ignore", async (req, res) => {
    const chatId = String((req.body || {}).chatId || "").trim();
    if (!chatId) {
      return res.status(400).json({ ok: false, error: "invalid_chatId" });
    }
    try {
      addToIgnoredChats(chatId);
      try {
        await syncSharedChatsToBackend(client);
      } catch (syncErr) {
        logger.warn(
          "[internal/bot-groups/ignore] sync companion:",
          syncErr && syncErr.message ? syncErr.message : syncErr,
        );
      }
      res.json({ ok: true });
    } catch (err) {
      const errMsg = err && (err.message || String(err));
      logger.error("[internal/bot-groups/ignore]", errMsg);
      res.status(500).json({ ok: false, error: errMsg });
    }
  });

  app.use(router);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: "not found" });
  });

  app.use((err, _req, res, _next) => {
    console.log("Internal API express error", err && err.message);
    res.status(500).json({ ok: false, error: String(err) });
  });

  return app;
}

async function startInternalApi(client, opts = {}) {
  if (server) return server;
  // Predefinição 80 (deploy típico / Square Cloud); em dev local define INTERNAL_API_PORT=3001 se precisares.
  const PORT = Number(opts.port || process.env.INTERNAL_API_PORT || 80);
  const HOST = process.env.INTERNAL_API_BIND || "0.0.0.0";

  appInstance = createApp(client);

  await new Promise((resolve, reject) => {
    server = appInstance.listen(PORT, HOST, (err) => {
      if (err) return reject(err);
      bootLog.line("internal", {
        ok: true,
        extra: `http://${HOST}:${PORT}`,
      });
      resolve();
    });
  });

  return server;
}

async function stopInternalApi() {
  if (!server) return;
  await new Promise((resolve) => {
    try {
      server.close(() => {
        logger.info("Internal API stopped");
        server = null;
        appInstance = null;
        resolve();
      });
    } catch (e) {
      server = null;
      appInstance = null;
      resolve();
    }
  });
}

module.exports = { startInternalApi, stopInternalApi };
