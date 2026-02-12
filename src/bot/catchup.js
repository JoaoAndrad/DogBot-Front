const logger = require("../utils/logger");
const storage = require("./storage");
const pipeline = require("./pipeline");
const chatCleaner = require("../utils/chatCleaner");
const fs = require("fs");
const path = require("path");

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
    logger.warn("Erro ao verificar primeira execução:", err);
    isFirstRun = false;
  }

  if (isFirstRun) {
    logger.info(
      "Catchup: primeira execução detectada - marcando todas as mensagens antigas como processadas",
    );
    // Criar checkpoints com timestamp atual para todos os chats
    for (const chat of chats) {
      try {
        const chatId =
          chat.id && chat.id._serialized
            ? chat.id._serialized
            : chat.id || chat.name || "unknown";

        // Buscar a última mensagem do chat
        const messages = await chat.fetchMessages({ limit: 1 });
        if (messages.length > 0 && messages[0].timestamp) {
          storage.setLastTs(chatId, messages[0].timestamp);
        }
      } catch (err) {
        logger.warn(
          `Catchup: erro ao marcar chat ${chat.id?._serialized}: ${err?.message}`,
        );
      }
    }
    logger.info("Catchup: todos os chats marcados como atualizados");
    return;
  }

  logger.info(`Catchup: iniciando para ${chats.length} chats`);

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
      const messages = await chat.fetchMessages({
        limit: Math.min(limitPerChat, 200),
      });
      const newMsgs = messages
        .filter((m) => m.timestamp && m.timestamp > lastTs && !m.fromMe)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (newMsgs.length === 0) continue;

      logger.info(`Catchup: ${newMsgs.length} mensagens novas em ${chatId}`);

      for (const msg of newMsgs) {
        try {
          // Delegar para pipeline; pipeline fará dedupe também
          await pipeline.processMessage({ client, msg });
          if (msg.id && msg.id._serialized)
            storage.markProcessed(msg.id._serialized);
          if (msg.timestamp) storage.setLastTs(chatId, msg.timestamp);
        } catch (err) {
          logger.warn(
            `Catchup: erro processando mensagem ${
              msg.id ? msg.id._serialized : "?"
            } em ${chatId}: ${err && err.message}`,
          );
        }
      }
    } catch (err) {
      logger.warn(
        `Catchup: erro no chat ${chat.id && chat.id._serialized}: ${
          err && err.message
        }`,
      );
    }
  }

  logger.info("Catchup: concluído");
}

module.exports = { runCatchup };
