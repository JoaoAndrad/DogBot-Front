const logger = require("../utils/logger");
const { loadIgnoredChats } = require("../utils/bot/chatCleaner");
const { serializedParticipantId } = require("../utils/whatsapp/whatsappParticipantIds");
const backendClient = require("./backendClient");

/**
 * Nome legível do chat (grupos: subject em groupMetadata se name vier vazio).
 * @param {object} chat
 * @returns {string|null}
 */
function resolveChatTitle(chat) {
  if (!chat) return null;
  const n =
    (chat.name != null && String(chat.name).trim()) ||
    (chat.formattedTitle != null && String(chat.formattedTitle).trim()) ||
    "";
  if (n) return n;
  if (chat.isGroup && chat.groupMetadata) {
    const gm = chat.groupMetadata;
    const subj = gm.subject != null ? String(gm.subject).trim() : "";
    if (subj) return subj;
  }
  return null;
}

/** @param {import("whatsapp-web.js").structures.Contact} contact */
function serializedIdFromContact(contact) {
  if (!contact || contact.id == null) return null;
  const id = contact.id;
  if (typeof id === "string") return id.trim();
  if (id._serialized) return String(id._serialized).trim();
  return null;
}

/**
 * Privado 1:1 com @lid: preferir `chat.getContact()` (API do WA para o chat actual).
 * Participantes de grupo: `getContactById` via {@link resolveCanonicalWaId}.
 *
 * Um mesmo contacto aparece como @lid e como @c.us. Sem canónico único, geram-se
 * dois POSTs de sync para o mesmo User — o segundo apaga os chats do primeiro.
 *
 * @param {import("whatsapp-web.js").Client} client
 * @param {string|null} jid
 * @param {Map<string, string>} cache
 */
async function resolveCanonicalWaId(client, jid, cache) {
  if (!jid || !client) return jid;
  const s = String(jid).trim();
  if (cache.has(s)) return cache.get(s);
  if (s.endsWith("@c.us") || s.endsWith("@s.whatsapp.net")) {
    cache.set(s, s);
    return s;
  }
  if (!s.endsWith("@lid")) {
    cache.set(s, s);
    return s;
  }
  try {
    const contact = await client.getContactById(s);
    const serStr = serializedIdFromContact(contact) || "";
    if (serStr.endsWith("@c.us") || serStr.endsWith("@s.whatsapp.net")) {
      cache.set(s, serStr);
      return serStr;
    }
  } catch (e) {
    logger.debug(
      "[companionChatSync] getContactById",
      s,
      e && e.message ? e.message : e,
    );
  }
  cache.set(s, s);
  return s;
}

/**
 * JID canónico (@c.us) para um chat privado, incluindo quando o id do chat é @lid.
 * @param {import("whatsapp-web.js").Chat} chat
 * @param {string} chatId
 * @param {import("whatsapp-web.js").Client} client
 * @param {Map<string, string>} cache
 */
async function resolvePrivateChatCanonicalId(chat, chatId, client, cache) {
  const cid = String(chatId).trim();
  if (cid.endsWith("@c.us") || cid.endsWith("@s.whatsapp.net")) {
    return cid;
  }
  if (!cid.endsWith("@lid")) return cid;

  try {
    if (typeof chat.getContact === "function") {
      const contact = await chat.getContact();
      const serStr = serializedIdFromContact(contact) || "";
      if (serStr.endsWith("@c.us") || serStr.endsWith("@s.whatsapp.net")) {
        cache.set(cid, serStr);
        return serStr;
      }
    }
  } catch (e) {
    logger.debug(
      "[companionChatSync] chat.getContact",
      cid,
      e && e.message ? e.message : e,
    );
  }
  return resolveCanonicalWaId(client, cid, cache);
}

/** @param {Map<string, unknown>} chatMap */
function groupChatIdsInMap(chatMap) {
  return new Set(
    [...chatMap.keys()].filter((id) => String(id).endsWith("@g.us")),
  );
}

/**
 * Junta entradas @lid com @c.us quando o mapa LID só tem grupos que já estão no mapa telefone
 * (mesmo usuário, duas chaves antes da resolução canónica).
 *
 * @param {Map<string, Map<string, { chatId: string, title: string|null, isGroup: boolean }>>} byUser
 */
function mergeDuplicateUserMaps(byUser) {
  const out = new Map(byUser);
  const keys = [...out.keys()];
  for (const lidKey of keys) {
    if (!String(lidKey).endsWith("@lid")) continue;
    const lidMap = out.get(lidKey);
    if (!lidMap) continue;
    const lidGroups = groupChatIdsInMap(lidMap);
    if (lidGroups.size === 0) continue;
    for (const phoneKey of keys) {
      if (phoneKey === lidKey) continue;
      if (
        !String(phoneKey).endsWith("@c.us") &&
        !String(phoneKey).endsWith("@s.whatsapp.net")
      ) {
        continue;
      }
      const phoneMap = out.get(phoneKey);
      if (!phoneMap) continue;
      const phoneGroups = groupChatIdsInMap(phoneMap);
      const subset = [...lidGroups].every((g) => phoneGroups.has(g));
      if (!subset) continue;
      if (phoneGroups.size < lidGroups.size) continue;
      for (const [cid, obj] of lidMap) {
        phoneMap.set(cid, obj);
      }
      out.delete(lidKey);
      break;
    }
  }
  return out;
}

/**
 * Envia para o backend a lista de chats em partilha user+bot (para GET /api/companion/chats).
 * Um POST batch com todos os contactos; o backend funde por userId (evita snapshot parcial).
 * `replace: true` — snapshot completo por usuário (merge de duplicados no bot antes).
 */
async function syncSharedChatsToBackend(client) {
  try {
    if (!client || !client.info || !client.info.wid) return;
    const botId = client.info.wid._serialized;
    const chats = await client.getChats();
    const ignoredChats = loadIgnoredChats();
    /** @type {Map<string, Map<string, { chatId: string, title: string|null, isGroup: boolean }>>} */
    const byUser = new Map();
    /** @type {Map<string, string>} */
    const lidToCanonical = new Map();

    for (const chat of chats) {
      try {
        const chatIdRaw = chat.id && chat.id._serialized;
        if (!chatIdRaw) continue;
        const chatId = String(chatIdRaw).trim();
        const title = resolveChatTitle(chat);
        const isGroup = !!chat.isGroup;

        if (isGroup && ignoredChats.has(chatId)) {
          continue;
        }

        if (isGroup) {
          const parts = chat.participants || [];
          for (const p of parts) {
            let jid = serializedParticipantId(p);
            if (!jid || jid === botId || String(jid).endsWith("@g.us"))
              continue;
            jid = await resolveCanonicalWaId(client, jid, lidToCanonical);
            if (!jid || jid === botId || String(jid).endsWith("@g.us"))
              continue;
            if (!byUser.has(jid)) byUser.set(jid, new Map());
            byUser
              .get(jid)
              .set(chatId, { chatId: chatId, title, isGroup: true });
          }
        } else if (!isGroup && chatId !== botId) {
          const canonicalPrivateId = await resolvePrivateChatCanonicalId(
            chat,
            chatId,
            client,
            lidToCanonical,
          );
          if (
            !canonicalPrivateId ||
            canonicalPrivateId === botId ||
            String(canonicalPrivateId).endsWith("@g.us")
          ) {
            continue;
          }
          if (
            !String(canonicalPrivateId).endsWith("@c.us") &&
            !String(canonicalPrivateId).endsWith("@s.whatsapp.net")
          ) {
            continue;
          }
          if (!byUser.has(canonicalPrivateId))
            byUser.set(canonicalPrivateId, new Map());
          byUser.get(canonicalPrivateId).set(canonicalPrivateId, {
            chatId: canonicalPrivateId,
            title,
            isGroup: false,
          });
        }
      } catch (e) {
        logger.debug(
          "[companionChatSync] skip chat",
          e && e.message ? e.message : e,
        );
      }
    }

    const mergedByUser = mergeDuplicateUserMaps(byUser);

    const batches = [...mergedByUser.entries()].map(([waId, chatMap]) => ({
      waId,
      chats: [...chatMap.values()],
    }));

    try {
      await backendClient.sendToBackend(
        "/api/internal/companion/sync-chats-batch",
        {
          batches,
          replace: true,
        },
        "POST",
      );
    } catch (e) {
      logger.debug(
        `[companionChatSync] batch: ${e && e.message ? e.message : e}`,
      );
    }

    logger.debug(
      `[companionChatSync] contatos =${mergedByUser.size} (raw=${byUser.size}) batches=${batches.length}`,
    );
  } catch (e) {
    logger.warn("[companionChatSync] falhou:", e && e.message ? e.message : e);
  }
}

module.exports = { syncSharedChatsToBackend };
