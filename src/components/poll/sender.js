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

      // Ensure chat is present in client's cache/store to avoid internal errors
      try {
        if (typeof client.getChatById === "function") {
          await client.getChatById(chatId).catch(() => {});
        }
      } catch (e) {
        // non-fatal
      }

      const poll = new Poll(title, normalizedOptionNames, optionsObj || {});

      // Try sending once, and retry once if we hit the markedUnread DOM race
      let sent = null;
      try {
        sent = await client.sendMessage(chatId, poll);
      } catch (err1) {
        const msg = err1 && (err1.message || err1.stack || "");
        if (String(msg).includes("markedUnread")) {
          // brief delay then retry
          await new Promise((r) => setTimeout(r, 800));
          try {
            sent = await client.sendMessage(chatId, poll);
          } catch (err2) {
            throw err2;
          }
        } else {
          throw err1;
        }
      }
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
