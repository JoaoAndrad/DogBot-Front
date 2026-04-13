const logger = require("../utils/logger");
const { loadIgnoredChats } = require("../utils/chatCleaner");
const { serializedParticipantId } = require("../utils/whatsappParticipantIds");
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

/**
 * Envia para o backend a lista de chats em partilha user+bot (para GET /api/companion/chats).
 * Um POST por contacto WA conhecido; falhas 404 (user não existe na BD) ignoram-se.
 */
async function syncSharedChatsToBackend(client) {
  try {
    if (!client || !client.info || !client.info.wid) return;
    const botId = client.info.wid._serialized;
    const chats = await client.getChats();
    const ignoredChats = loadIgnoredChats();
    /** @type {Map<string, Map<string, { chatId: string, title: string|null, isGroup: boolean }>>} */
    const byUser = new Map();

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
            const jid = serializedParticipantId(p);
            if (!jid || jid === botId || String(jid).endsWith("@g.us")) continue;
            if (!byUser.has(jid)) byUser.set(jid, new Map());
            byUser
              .get(jid)
              .set(chatId, { chatId: chatId, title, isGroup: true });
          }
        } else if (String(chatId).endsWith("@c.us") && chatId !== botId) {
          if (!byUser.has(chatId)) byUser.set(chatId, new Map());
          byUser
            .get(chatId)
            .set(chatId, { chatId: chatId, title, isGroup: false });
        }
      } catch (e) {
        logger.debug(
          "[companionChatSync] skip chat",
          e && e.message ? e.message : e,
        );
      }
    }

    let ok = 0;
    let skipped = 0;
    for (const [waId, chatMap] of byUser) {
      const chatsPayload = [...chatMap.values()];
      try {
        await backendClient.sendToBackend(
          "/api/internal/companion/sync-chats",
          {
            waId,
            chats: chatsPayload,
          },
          "POST",
          { silentHttpStatuses: [404] },
        );
        ok++;
      } catch (e) {
        if (e && e.status === 404) {
          skipped++;
          continue;
        }
        logger.debug(
          `[companionChatSync] ${waId}: ${e && e.message ? e.message : e}`,
        );
      }
    }

    logger.info(
      `[companionChatSync] contactos=${byUser.size} ok=${ok} skipped_404=${skipped}`,
    );
  } catch (e) {
    logger.warn(
      "[companionChatSync] falhou:",
      e && e.message ? e.message : e,
    );
  }
}

module.exports = { syncSharedChatsToBackend };
