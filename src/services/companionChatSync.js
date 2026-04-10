const logger = require("../utils/logger");
const backendClient = require("./backendClient");

/**
 * Envia para o backend a lista de chats em partilha user+bot (para GET /api/companion/chats).
 * Um POST por contacto WA conhecido; falhas 404 (user não existe na BD) ignoram-se.
 */
async function syncSharedChatsToBackend(client) {
  try {
    if (!client || !client.info || !client.info.wid) return;
    const botId = client.info.wid._serialized;
    const chats = await client.getChats();
    /** @type {Map<string, Map<string, { chatId: string, title: string|null, isGroup: boolean }>>} */
    const byUser = new Map();

    for (const chat of chats) {
      try {
        const chatId = chat.id && chat.id._serialized;
        if (!chatId) continue;
        const title =
          (chat.name != null && String(chat.name)) ||
          (chat.formattedTitle != null && String(chat.formattedTitle)) ||
          null;
        const isGroup = !!chat.isGroup;

        if (isGroup) {
          const parts = chat.participants || [];
          for (const p of parts) {
            const jid = p.id && p.id._serialized;
            if (!jid || jid === botId || String(jid).endsWith("@g.us")) continue;
            if (!byUser.has(jid)) byUser.set(jid, new Map());
            byUser
              .get(jid)
              .set(chatId, { chatId, title, isGroup: true });
          }
        } else if (String(chatId).endsWith("@c.us") && chatId !== botId) {
          if (!byUser.has(chatId)) byUser.set(chatId, new Map());
          byUser
            .get(chatId)
            .set(chatId, { chatId, title, isGroup: false });
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
