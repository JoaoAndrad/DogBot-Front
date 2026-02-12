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
 */
async function archiveInactiveChat(chat, chatId, reason = "bot not in group") {
  try {
    if (chat && typeof chat.delete === "function") {
      await chat.delete();
      logger.info(`[ChatCleaner] Deleted chat ${chatId}: ${reason}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.warn(
      `[ChatCleaner] Could not delete chat ${chatId}:`,
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
      await archiveInactiveChat(chat, chatId, "no participants");
      return false;
    }

    return true; // Bot is still in group
  } catch (error) {
    // getChatById failed - bot is not in group anymore
    await archiveInactiveChat(chat, chatId, "bot removed from group");
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
    stats.total = chats.length;

    for (const chat of chats) {
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
        logger.warn(`[ChatCleaner] Error processing chat:`, error.message);
      }
    }

    logger.info(
      `[ChatCleaner] Cleanup complete: ${stats.deleted} deleted out of ${stats.total} total chats`,
    );
  } catch (error) {
    logger.error(`[ChatCleaner] Error during cleanup:`, error);
  }

  return stats;
}

module.exports = {
  archiveInactiveChat,
  verifyAndCleanGroupChat,
  cleanAllInactiveChats,
};
