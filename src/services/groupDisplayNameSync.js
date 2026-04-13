const backendClient = require("./backendClient");
const logger = require("../utils/logger");
const {
  archiveInactiveChat,
  addToIgnoredChats,
  loadIgnoredChats,
} = require("../utils/bot/chatCleaner");

let lastFullSyncAt = 0;
/** Entre e2e_notification repetidos, evita rajadas de getChats + POST. */
const DEBOUNCE_MS = 15_000;

function getBotSerializedId(client) {
  if (client?.info?.wid?._serialized) return client.info.wid._serialized;
  if (client?.info?.me?._serialized) return client.info.me._serialized;
  return null;
}

/**
 * True se o bot consta nos participantes (getChats pode devolver chats órfãos após remoção).
 * @param {import("whatsapp-web.js").Client} client
 * @param {import("whatsapp-web.js").Chat} chat
 */
async function botIsGroupParticipant(client, chat) {
  const botId = getBotSerializedId(client);
  if (!botId) return true;

  let participants = chat.participants;
  if (!participants || participants.length === 0) {
    try {
      const fresh = await client.getChatById(chat.id._serialized);
      participants = fresh && fresh.participants;
    } catch {
      return false;
    }
  }
  if (!participants || participants.length === 0) return false;
  return participants.some((p) => p && p.id && p.id._serialized === botId);
}

/**
 * Tenta sair do grupo e remove o chat local (getChats pode manter entrada fantasma após kick).
 * @param {import("whatsapp-web.js").Chat} chat
 * @param {string} chatId
 */
async function leaveAndRemoveOrphanGroupChat(chat, chatId) {
  try {
    if (chat && typeof chat.leave === "function") {
      await chat.leave();
    }
  } catch (e) {
    logger.debug(
      `[groupDisplayNameSync] leave órfão ${chatId}:`,
      e && e.message,
    );
  }
  const deleted = await archiveInactiveChat(
    chat,
    chatId,
    "órfão: bot não é participante",
  );
  addToIgnoredChats(chatId);
  return deleted;
}

/**
 * Envia para o backend o nome de todos os grupos (@g.us) em que o bot está.
 * @param {import("whatsapp-web.js").Client} client
 * @param {{ force?: boolean }} [opts] - `force: true` ignora debounce (ex.: após Catchup: concluído)
 */
async function syncAllGroupDisplayNames(client, opts = {}) {
  if (!client || typeof client.getChats !== "function") {
    return { skipped: true, reason: "no_client" };
  }

  const force = opts.force === true;
  const now = Date.now();
  if (!force && now - lastFullSyncAt < DEBOUNCE_MS) {
    return { skipped: true, reason: "debounce" };
  }
  lastFullSyncAt = now;

  let chats;
  try {
    chats = await client.getChats();
  } catch (e) {
    logger.warn("[groupDisplayNameSync] getChats:", e && e.message);
    return { error: e && e.message };
  }

  const groups = chats.filter(
    (c) =>
      c &&
      c.id &&
      c.id._serialized &&
      String(c.id._serialized).endsWith("@g.us"),
  );

  const ignoredChats = loadIgnoredChats();

  let ok = 0;
  let skippedEmpty = 0;
  let skippedIgnored = 0;
  let skippedNotParticipant = 0;
  let orphanRemoved = 0;
  let orphanRemoveFail = 0;
  let fail = 0;

  for (const chat of groups) {
    const chatId = chat.id._serialized;

    if (ignoredChats.has(chatId)) {
      skippedIgnored++;
      continue;
    }

    const inGroup = await botIsGroupParticipant(client, chat);
    if (!inGroup) {
      skippedNotParticipant++;
      try {
        const removed = await leaveAndRemoveOrphanGroupChat(chat, chatId);
        if (removed) orphanRemoved++;
        else orphanRemoveFail++;
      } catch (e) {
        orphanRemoveFail++;
        logger.warn(
          `[groupDisplayNameSync] órfão ${chatId}:`,
          e && e.message,
        );
      }
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }

    const name = chat.name && String(chat.name).trim();
    if (!name) {
      skippedEmpty++;
      continue;
    }
    try {
      await backendClient.sendToBackend("/api/internal/group-chat-display", {
        chatId,
        name,
      });
      ok++;
    } catch {
      fail++;
    }
    await new Promise((r) => setTimeout(r, 25));
  }

  const processed = groups.length - skippedIgnored;
  logger.info(
    `[groupDisplayNameSync] BD ← ${ok}/${processed} grupos (cache ignorados: ${skippedIgnored}; órfãos: ${skippedNotParticipant} → removidos: ${orphanRemoved}, falha delete: ${orphanRemoveFail}; sem nome c/ participação: ${skippedEmpty}; HTTP: ${fail} falhas)`,
  );
  return {
    ok,
    total: groups.length,
    processed,
    skippedIgnored,
    skippedEmpty,
    skippedNotParticipant,
    orphanRemoved,
    orphanRemoveFail,
    fail,
  };
}

module.exports = { syncAllGroupDisplayNames };
