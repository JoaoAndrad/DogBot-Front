const handlers = require("../handlers");
const logger = require("../utils/logger");
const storage = require("./storage");

async function processMessage(context) {
  try {
    const msg = context.msg;
    const msgId =
      msg && msg.id && msg.id._serialized ? msg.id._serialized : null;

    if (msgId && storage.isProcessed(msgId)) {
      console.log("Pipeline: mensagem já processada, pulando", { msgId });
      return false;
    }

    const info = {
      id: msgId,
      from: msg.from || (msg._data && msg._data.from),
      body: msg.body || msg.caption || "",
    };

    await handlers.handle({ ...context, info });

    // Marcar como processada e atualizar checkpoint
    if (msgId) storage.markProcessed(msgId);
    const chatId = info.from;
    if (chatId && msg.timestamp) storage.setLastTs(chatId, msg.timestamp);

    return true;
  } catch (err) {
    console.log("Pipeline erro:", err);
    return false;
  }
}

module.exports = { processMessage };
