const logger = require("../utils/logger");
const middleware = require("./middleware");
const dedupe = require("./dedupe");
const botMetricsReporter = require("../services/botMetricsReporter");

async function processEvent(context) {
  try {
    if (await dedupe.isDuplicate(context)) {
      console.log("pipeline: duplicate message, skipping");
      return false;
    }

    const msg = context.msg || {};
    const chatId = msg.from || (msg._data && msg._data.from);
    const fromId = msg.author || msg.from || (msg._data && msg._data.from);
    let chatName = null;
    try {
      if (msg.getChat) {
        const chat = await msg.getChat();
        chatName = chat && chat.name ? chat.name : null;
      }
    } catch (_) {}
    context.chatName = chatName;

    botMetricsReporter
      .reportEvent("message_received", { chatId, fromId, chatName })
      .catch(() => {});

    const ok = await middleware.run(context);
    if (!ok) return false;

    const handlers = require("../handlers");
    try {
      await handlers.handle(context);
    } finally {
      // Sempre conta como processada (mesmo se handle() lançar) — fonte: frontend
      botMetricsReporter
        .reportEvent("message_processed", { chatId, fromId, chatName })
        .catch(() => {});
    }

    await dedupe.markProcessed(context);
    return true;
  } catch (err) {
    console.log("pipeline error", err);
    return false;
  }
}

module.exports = { processEvent };
