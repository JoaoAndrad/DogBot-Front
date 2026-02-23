const { Poll } = require("whatsapp-web.js");
const logger = require("../../utils/logger");

function createSender(client) {
  if (!client) throw new Error("client is required to create sender");

  async function _openChatIfNeeded(chatId) {
    try {
      if (
        client.interface &&
        typeof client.interface.openChatWindow === "function"
      ) {
        await client.interface.openChatWindow(chatId).catch(() => {});
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch (e) {
      console.log(
        "openChatWindow failed (non-fatal)",
        e && (e.message || e.stack)
      );
    }
  }

  async function sendPoll(payload, opts = {}) {
    if (!payload || !payload.chatId)
      throw new Error("payload.chatId is required");
    const { chatId, title, options, optionsObj } = payload;

    if (typeof Poll !== "function") {
      console.log("Native Poll not available in runtime");
      return null;
    }

    // Normalize options to strings for whatsapp-web.js Poll constructor
    const normalizedOptionNames = Array.isArray(options)
      ? options.map((o, i) => {
          if (o == null) return String(i);
          if (typeof o === "string") return o;
          if (typeof o === "object" && o.name != null) return String(o.name);
          return String(o);
        })
      : [];

    const pollOptions = normalizedOptionNames.map((name, i) => ({
      name,
      localId: i,
    }));

    try {
      await _openChatIfNeeded(chatId);

      // Get chat object first to ensure it's properly loaded before sending
      const chat = await client.getChatById(chatId);
      if (!chat) {
        throw new Error(`Chat not found: ${chatId}`);
      }

      const poll = new Poll(title, normalizedOptionNames, optionsObj || {});

      // sendSeen is disabled globally in the client wrapper (see bot/index.js)
      const sent = await client.sendMessage(chatId, poll);
      const msgId =
        sent && sent.id && sent.id._serialized ? sent.id._serialized : sent.id;
      return { sent, msgId, type: "native", pollOptions };
    } catch (err) {
      console.log("sendPoll: failed to send native poll", {
        chatId,
        title,
        err: err && (err.stack || err.message || err),
      });
      return null;
    }
  }

  return { sendPoll };
}

module.exports = { createSender };
