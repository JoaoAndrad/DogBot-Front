const backendClient = require("./backendClient");
const logger = require("../utils/logger");

/**
 * Get list of group chat IDs where the user is a member and workout tracking is enabled.
 * Used to notify and update description in all those groups after /treinei.
 * @param {Object} client - WhatsApp client instance
 * @param {string} senderNumber - User's WhatsApp number (without @c.us)
 * @returns {Promise<string[]>} Array of group chat IDs
 */
async function getGroupsWithTrackingForUser(client, senderNumber) {
  const chatIds = [];
  try {
    const chats = await client.getChats();
    const groups = chats.filter(
      (c) => c.isGroup || String(c.id._serialized).endsWith("@g.us"),
    );
    const cleanSender = String(senderNumber).replace(/@c\.us$/i, "");

    for (const group of groups) {
      try {
        const groupChatId = group.id._serialized;
        const settings = await backendClient.sendToBackend(
          `/api/workouts/groups/${encodeURIComponent(groupChatId)}/settings`,
          null,
          "GET",
        );
        if (!settings || !settings.workoutTrackingEnabled) continue;

        const participants = group.participants || [];
        const isMember = participants.some((p) => {
          const num = p.id?.user || p.id?._serialized?.replace(/@c\.us$/i, "") || "";
          return num === cleanSender || num.includes(cleanSender) || cleanSender.includes(num);
        });
        if (isMember) chatIds.push(groupChatId);
      } catch (err) {
        logger.debug(`[workoutNotification] Skip group ${group.id?._serialized}: ${err?.message}`);
      }
    }
  } catch (err) {
    logger.error("[workoutNotification] getGroupsWithTrackingForUser error:", err);
  }
  return chatIds;
}

/**
 * Send workout message to a list of group chat IDs (used after /treinei to notify all groups).
 * @param {Object} client - WhatsApp client instance
 * @param {string[]} chatIds - Group chat IDs to notify
 * @param {Object} stats - Workout stats (streak, etc.)
 * @param {string} displayName - User display name
 */
async function sendWorkoutMessageToGroups(client, chatIds, stats, displayName) {
  const message = `🏋️ ${displayName || "Usuário"} registrou um treino!\n🔥 Sequência: ${stats.streak} dia${stats.streak > 1 ? "s" : ""}`;
  for (const groupChatId of chatIds) {
    try {
      await client.sendMessage(groupChatId, message);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      logger.error(`[workoutNotification] Error sending to ${groupChatId}:`, err?.message);
    }
  }
}

/**
 * Notify workout to all groups where user is a member
 * @param {Object} client - WhatsApp client instance
 * @param {string} senderNumber - User's WhatsApp number
 * @param {Object} stats - Workout stats (streak, total_workouts, etc.)
 * @param {string} excludeChatId - Chat ID to exclude from notifications (where workout was logged)
 * @param {string} userDisplayName - User's display name (optional)
 */
async function notifyWorkoutToGroups(
  client,
  senderNumber,
  stats,
  excludeChatId,
  userDisplayName = null,
) {
  try {
    // Get all chats
    const chats = await client.getChats();

    // Filter groups only
    const groups = chats.filter(
      (c) => c.isGroup || String(c.id._serialized).endsWith("@g.us"),
    );

    logger.debug(
      `[workoutNotification] Found ${groups.length} groups to check`,
    );

    for (const group of groups) {
      try {
        const groupChatId = group.id._serialized;

        // Skip the group where workout was logged
        if (groupChatId === excludeChatId) {
          continue;
        }

        // Fetch group settings
        const settings = await backendClient.sendToBackend(
          `/api/workouts/groups/${groupChatId}/settings`,
          null,
          "GET",
        );

        // Skip if notifications are disabled
        if (!settings || !settings.workoutNotifications) {
          continue;
        }

        // Check if user is a member of this group
        const participants = group.participants || [];
        const cleanSenderNumber = senderNumber.replace(/@c\.us$/i, "");

        const isMember = participants.some((p) => {
          const participantNumber =
            p.id.user || p.id._serialized.replace(/@c\.us$/i, "");
          return (
            participantNumber === cleanSenderNumber ||
            participantNumber.includes(cleanSenderNumber) ||
            cleanSenderNumber.includes(participantNumber)
          );
        });

        if (!isMember) {
          continue;
        }

        // Use provided displayName or try to get from participants
        let displayName = userDisplayName;

        if (!displayName) {
          // Fallback: try to get from participants
          const participant = participants.find((p) => {
            const participantNumber =
              p.id.user || p.id._serialized.replace(/@c\.us$/i, "");
            return participantNumber === cleanSenderNumber;
          });
          displayName =
            participant?.pushname || participant?.notify || "Usuário";
        }

        // Send notification
        const message = `🏋️ ${displayName} registrou um treino!\n🔥 Sequência: ${stats.streak} dia${stats.streak > 1 ? "s" : ""}`;

        await client.sendMessage(groupChatId, message);

        logger.debug(
          `[workoutNotification] Sent notification to group ${groupChatId}`,
        );

        // Throttle to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (groupError) {
        logger.error(
          `[workoutNotification] Error processing group ${group.id._serialized}:`,
          groupError,
        );
        // Continue with next group
      }
    }
  } catch (error) {
    logger.error("[workoutNotification] Error notifying workout:", error);
  }
}

module.exports = {
  getGroupsWithTrackingForUser,
  sendWorkoutMessageToGroups,
  notifyWorkoutToGroups,
};
