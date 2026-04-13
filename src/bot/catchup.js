const logger = require("../utils/logger");
const storage = require("./storage");
const pipeline = require("./pipeline");
const chatCleaner = require("../utils/bot/chatCleaner");
const groupDisplayNameSync = require("../services/groupDisplayNameSync");
const fs = require("fs");
const path = require("path");

/** Erro interno do WA Web quando o chat/store ainda não está pronto (loadEarlierMsgs / fetchMessages). */
function isTransientWaChatError(err) {
  const m = err && err.message ? String(err.message) : "";
  return m.includes("waitForChatLoading");
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchMessagesSafe(chat, opts) {
  try {
    return await chat.fetchMessages(opts);
  } catch (e) {
    if (!isTransientWaChatError(e)) throw e;
    await delay(1500);
    return await chat.fetchMessages(opts);
  }
}

async function runCatchup(client, options = {}) {
  const limitPerChat = options.limitPerChat || 200;
  const chats = await client.getChats();

  // Verificar se a pasta data está vazia (primeira execução)
  const dataDir = path.join(__dirname, "..", "..", "data");
  const checkpointsFile = path.join(dataDir, "checkpoints.json");
  const processedFile = path.join(dataDir, "processed.json");

  // Verificar se é primeira execução: arquivos não existem OU estão vazios
  let isFirstRun = false;
  try {
    const checkpointsExist = fs.existsSync(checkpointsFile);
    const processedExist = fs.existsSync(processedFile);

    if (!checkpointsExist && !processedExist) {
      isFirstRun = true;
    } else if (checkpointsExist || processedExist) {
      // Verificar se os arquivos existem mas estão vazios
      const checkpointsData = checkpointsExist
        ? JSON.parse(fs.readFileSync(checkpointsFile, "utf8") || "{}")
        : {};
      const processedData = processedExist
        ? JSON.parse(fs.readFileSync(processedFile, "utf8") || "{}")
        : {};

      isFirstRun =
        Object.keys(checkpointsData).length === 0 &&
        Object.keys(processedData).length === 0;
    }
  } catch (err) {
    isFirstRun = false;
  }

  if (isFirstRun) {
    logger.info("Catchup: firstrun");
    // Criar checkpoints com timestamp atual para todos os chats
    for (const chat of chats) {
      try {
        const chatId =
          chat.id && chat.id._serialized
            ? chat.id._serialized
            : chat.id || chat.name || "unknown";

        // Buscar a última mensagem do chat
        const messages = await fetchMessagesSafe(chat, { limit: 1 });
        if (messages.length > 0 && messages[0].timestamp) {
          storage.setLastTs(chatId, messages[0].timestamp);
        }
      } catch (err) {
        /* transientes ignorados */
      }
    }
    try {
      await groupDisplayNameSync.syncAllGroupDisplayNames(client, {
        force: true,
      });
    } catch (e) {
      /* silencioso */
    }
    return;
  }

  for (const chat of chats) {
    try {
      const chatId =
        chat.id && chat.id._serialized
          ? chat.id._serialized
          : chat.id || chat.name || "unknown";

      // For group chats, verify bot is still a member before processing
      const stillInGroup = await chatCleaner.verifyAndCleanGroupChat(
        client,
        chat,
        chatId,
      );

      if (!stillInGroup) {
        continue; // Skip this deleted chat
      }

      const lastTs = storage.getLastTs(chatId) || 0;
      // Buscar últimas mensagens (limit)
      const messages = await fetchMessagesSafe(chat, {
        limit: Math.min(limitPerChat, 200),
      });
      const newMsgs = messages
        .filter((m) => m.timestamp && m.timestamp > lastTs && !m.fromMe)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (newMsgs.length === 0) continue;

      for (const msg of newMsgs) {
        try {
          // Delegar para pipeline; pipeline fará dedupe também
          await pipeline.processMessage({
            client,
            msg,
            fromCatchup: true,
          });
          if (msg.id && msg.id._serialized)
            storage.markProcessed(msg.id._serialized);
          if (msg.timestamp) storage.setLastTs(chatId, msg.timestamp);
        } catch (err) {
          /* silencioso */
        }
      }
    } catch (err) {
      if (isTransientWaChatError(err)) continue;
    }
  }

  logger.info("Catchup: concluído");
  try {
    await groupDisplayNameSync.syncAllGroupDisplayNames(client, {
      force: true,
    });
  } catch (e) {
    /* silencioso */
  }
}

module.exports = { runCatchup };
