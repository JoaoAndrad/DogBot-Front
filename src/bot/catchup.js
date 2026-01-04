const logger = require("../utils/logger");
const storage = require("./storage");
const pipeline = require("./pipeline");

async function runCatchup(client, options = {}) {
  const limitPerChat = options.limitPerChat || 200;
  const chats = await client.getChats();
  console.log(`Catchup: iniciando para ${chats.length} chats`);

  for (const chat of chats) {
    try {
      const chatId =
        chat.id && chat.id._serialized
          ? chat.id._serialized
          : chat.id || chat.name || "unknown";
      const lastTs = storage.getLastTs(chatId) || 0;
      // Buscar últimas mensagens (limit)
      const messages = await chat.fetchMessages({
        limit: Math.min(limitPerChat, 200),
      });
      const newMsgs = messages
        .filter((m) => m.timestamp && m.timestamp > lastTs && !m.fromMe)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (newMsgs.length === 0) continue;

      console.log(`Catchup: ${newMsgs.length} mensagens novas em ${chatId}`);

      for (const msg of newMsgs) {
        try {
          // Delegar para pipeline; pipeline fará dedupe também
          await pipeline.processMessage({ client, msg });
          if (msg.id && msg.id._serialized)
            storage.markProcessed(msg.id._serialized);
          if (msg.timestamp) storage.setLastTs(chatId, msg.timestamp);
        } catch (err) {
          console.log(
            `Catchup: erro processando mensagem ${
              msg.id ? msg.id._serialized : "?"
            } em ${chatId}: ${err && err.message}`
          );
        }
      }
    } catch (err) {
      console.log(
        `Catchup: erro no chat ${chat.id && chat.id._serialized}: ${
          err && err.message
        }`
      );
    }
  }

  console.log("Catchup: concluído");
}

module.exports = { runCatchup };
