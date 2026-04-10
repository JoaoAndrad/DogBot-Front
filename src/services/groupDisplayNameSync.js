const backendClient = require("./backendClient");
const logger = require("../utils/logger");

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

  let ok = 0;
  let skippedEmpty = 0;
  let skippedNotParticipant = 0;
  let fail = 0;

  for (const chat of groups) {
    const chatId = chat.id._serialized;

    const inGroup = await botIsGroupParticipant(client, chat);
    if (!inGroup) {
      skippedNotParticipant++;
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

  logger.info(
    `[groupDisplayNameSync] BD ← ${ok}/${groups.length} grupos (fora do grupo/órfão: ${skippedNotParticipant}; sem nome c/ participação: ${skippedEmpty}; HTTP: ${fail} falhas)`,
  );
  return {
    ok,
    total: groups.length,
    skippedEmpty,
    skippedNotParticipant,
    fail,
  };
}

module.exports = { syncAllGroupDisplayNames };
