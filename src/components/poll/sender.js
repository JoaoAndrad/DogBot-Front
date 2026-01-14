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

      // Send message without triggering sendSeen to avoid markedUnread error
      // Use the internal sendMessage with options to skip the automatic read receipt
      const sent = await client.sendMessage(chatId, poll, { sendSeen: false });
      const msgId =
        sent && sent.id && sent.id._serialized ? sent.id._serialized : sent.id;
      return { sent, msgId, type: "native", pollOptions };
    } catch (err) {
      // Check if it's the specific markedUnread error
      const errStr = err && (err.stack || err.message || String(err));
      const isMarkedUnreadError = errStr.includes("markedUnread");

      if (isMarkedUnreadError) {
        console.log(
          "sendPoll: encountered markedUnread error (non-fatal), sending via low-level API",
          {
            chatId,
            title,
          }
        );
        // Use Puppeteer directly to bypass sendSeen
        try {
          const poll = new Poll(title, normalizedOptionNames, optionsObj || {});

          // Use the lower-level pupPage to send without calling sendSeen
          const result = await client.pupPage.evaluate(
            async (chatId, pollData) => {
              const chat = await window.Store.Chat.get(chatId);
              const poll = new window.Store.Poll({
                name: pollData.title,
                options: pollData.options.map((opt, idx) => ({
                  name: opt,
                  localId: idx,
                })),
                ...pollData.optionsObj,
              });

              // Send without calling sendSeen
              const msg = await window.WWebJS.sendMessage(
                chat,
                poll,
                { createChat: true },
                false // sendSeen = false
              );

              return window.WWebJS.getMessageModel(msg);
            },
            chatId,
            {
              title,
              options: normalizedOptionNames,
              optionsObj: optionsObj || {},
            }
          );

          if (result) {
            const msgId =
              result.id && result.id._serialized
                ? result.id._serialized
                : result.id;
            return { sent: result, msgId, type: "native", pollOptions };
          }
        } catch (retryErr) {
          console.log("sendPoll: low-level API also failed", {
            chatId,
            title,
            err: retryErr && (retryErr.stack || retryErr.message || retryErr),
          });
        }
      }

      console.log("sendPoll: failed to send native poll", {
        chatId,
        title,
        err: errStr,
      });
      return null;
    }
  }

  return { sendPoll };
}

module.exports = { createSender };
