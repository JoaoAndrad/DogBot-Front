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
  const { CATCHUP_MAX_AGE_SECS } = require("../constants");
  const limitPerChat = options.limitPerChat || 200;
  // Messages older than this are skipped entirely (bot was down too long).
  // Only the checkpoint is advanced so they're not reprocessed on next restart.
  const maxAgeSecs = Math.max(0, CATCHUP_MAX_AGE_SECS);
  const nowSecs = Math.floor(Date.now() / 1000);

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

  // Fase 1 — recolha paralela: verificar membership + buscar mensagens (sem enviar nada).
  // Paralelizar aqui é seguro porque não há envio de mensagens ao WA.
  const FETCH_CONCURRENCY = 5;
  const fetchQueue = [...chats];
  /** @type {{ chatId: string, msgs: any[] }[]} */
  const pendingMessages = [];

  const fetchWorkers = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, fetchQueue.length) },
    async () => {
      while (fetchQueue.length > 0) {
        const chat = fetchQueue.shift();
        if (!chat) continue;
        try {
          const chatId =
            chat.id && chat.id._serialized
              ? chat.id._serialized
              : chat.id || chat.name || "unknown";

          const stillInGroup = await chatCleaner.verifyAndCleanGroupChat(
            client,
            chat,
            chatId,
          );
          if (!stillInGroup) continue;

          const lastTs = storage.getLastTs(chatId) || 0;
          const messages = await fetchMessagesSafe(chat, {
            limit: Math.min(limitPerChat, 200),
          });
          const cutoffTs = maxAgeSecs > 0 ? nowSecs - maxAgeSecs : 0;
          const allNewMsgs = messages
            .filter((m) => m.timestamp && m.timestamp > lastTs && !m.fromMe)
            .sort((a, b) => a.timestamp - b.timestamp);

          // Advance checkpoint for messages that are too old, without processing them
          const tooOld = allNewMsgs.filter((m) => cutoffTs > 0 && m.timestamp < cutoffTs);
          for (const m of tooOld) {
            if (m.id && m.id._serialized) storage.markProcessed(m.id._serialized);
            if (m.timestamp) storage.setLastTs(chatId, m.timestamp);
          }

          const newMsgs = allNewMsgs.filter(
            (m) => cutoffTs === 0 || m.timestamp >= cutoffTs,
          );

          if (newMsgs.length > 0) {
            pendingMessages.push({ chatId, msgs: newMsgs });
          }
        } catch (err) {
          if (!isTransientWaChatError(err)) {
            /* silencioso */
          }
        }
      }
    },
  );
  await Promise.allSettled(fetchWorkers);

  // Fase 2 — processamento serial: percorre chats em ordem, com delay entre mensagens.
  // Serial para não disparar burst de notificações que possam levar a ban no WhatsApp.
  for (const { chatId, msgs } of pendingMessages) {
    for (const msg of msgs) {
      try {
        await pipeline.processMessage({ client, msg, fromCatchup: true });
        if (msg.id && msg.id._serialized)
          storage.markProcessed(msg.id._serialized);
        if (msg.timestamp) storage.setLastTs(chatId, msg.timestamp);
        // Pausa mínima entre mensagens para não parecer spam ao WA
        await delay(150);
      } catch (err) {
        /* silencioso */
      }
    }
  }

  logger.info("Catchup: concluído");
  // Run in background — sync is non-critical and shouldn't delay the ready state
  groupDisplayNameSync
    .syncAllGroupDisplayNames(client, { force: true })
    .catch(() => {});
}

module.exports = { runCatchup };
