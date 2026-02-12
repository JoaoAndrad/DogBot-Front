/**
 * Chat Cleaner Utility
 * Handles deletion of stale/inactive group chats where bot is no longer a member
 */

const logger = require("./logger");

/**
 * Deletes a chat that the bot is no longer part of
 * @param {Object} chat - Chat object from WhatsApp client
 * @param {string} chatId - Chat ID
 * @param {string} reason - Reason for deletion (for logging)
 * @returns {Promise<boolean>} true if deleted successfully, false otherwise
 */
async function archiveInactiveChat(chat, chatId, reason = "bot not in group") {
  try {
    if (chat && typeof chat.delete === "function") {
      await chat.delete();
      logger.debug(`[ChatCleaner] ✅ Chat excluído: ${chatId} (${reason})`);
      return true;
    }
    logger.warn(
      `[ChatCleaner] ⚠️  Chat não pôde ser excluído (método delete não disponível): ${chatId}`,
    );
    return false;
  } catch (error) {
    logger.warn(
      `[ChatCleaner] ❌ Erro ao excluir chat ${chatId}:`,
      error.message,
    );
    return false;
  }
}

/**
 * Verify if bot is still a member of a group and delete chat if not
 * @param {Object} client - WhatsApp client instance
 * @param {Object} chat - Chat object
 * @param {string} chatId - Chat ID
 * @returns {Promise<boolean>} true if bot is in group, false otherwise
 */
async function verifyAndCleanGroupChat(client, chat, chatId) {
  const isGroup = !!chat.isGroup || (chatId && chatId.endsWith("@g.us"));

  if (!isGroup) {
    return true; // Not a group, no need to verify
  }

  try {
    // Try to get fresh chat data to verify bot is still in the group
    const freshChat = await client.getChatById(chatId);

    if (
      !freshChat ||
      !freshChat.participants ||
      freshChat.participants.length === 0
    ) {
      // Group has no participants - delete it
      const groupName = chat.name || chatId.split("@")[0];
      logger.info(
        `[ChatCleaner] ❌ Grupo sem participantes: ${groupName} (${chatId})`,
      );
      const deleted = await archiveInactiveChat(
        chat,
        chatId,
        "no participants",
      );
      if (deleted) {
        logger.info(`[ChatCleaner] 🗑️  Chat excluído: ${groupName}`);
      }
      return false;
    }

    return true; // Bot is still in group
  } catch (error) {
    // getChatById failed - bot is not in group anymore
    const groupName = chat.name || chatId.split("@")[0];
    logger.info(
      `[ChatCleaner] ❌ Bot não está mais no grupo: ${groupName} (${chatId})`,
    );
    const deleted = await archiveInactiveChat(
      chat,
      chatId,
      "bot removed from group",
    );
    if (deleted) {
      logger.info(`[ChatCleaner] 🗑️  Chat excluído: ${groupName}`);
    }
    return false;
  }
}

/**
 * Clean all inactive group chats from client's chat list
 * @param {Object} client - WhatsApp client instance
 * @returns {Promise<{total: number, deleted: number}>} Cleanup statistics
 */
async function cleanAllInactiveChats(client) {
  const stats = { total: 0, deleted: 0 };

  try {
    const chats = await client.getChats();
    const groups = chats.filter(
      (c) =>
        !!c.isGroup ||
        (c.id &&
          c.id._serialized &&
          String(c.id._serialized).endsWith("@g.us")),
    );

    stats.total = groups.length;

    logger.info(`[ChatCleaner] 📊 Iniciando limpeza de ${stats.total} grupos`);

    for (const chat of groups) {
      try {
        const chatId =
          chat.id && chat.id._serialized
            ? chat.id._serialized
            : chat.id || null;

        if (!chatId) continue;

        const stillInGroup = await verifyAndCleanGroupChat(
          client,
          chat,
          chatId,
        );

        if (!stillInGroup) {
          stats.deleted++;
        }
      } catch (error) {
        logger.warn(`[ChatCleaner] ⚠️  Erro ao processar chat:`, error.message);
      }
    }

    logger.info(
      `[ChatCleaner] ✅ Limpeza concluída: ${stats.deleted} chats excluídos de ${stats.total} grupos`,
    );
  } catch (error) {
    logger.error(`[ChatCleaner] ❌ Erro durante limpeza:`, error);
  }

  return stats;
}

module.exports = {
  archiveInactiveChat,
  verifyAndCleanGroupChat,
  cleanAllInactiveChats,
};
