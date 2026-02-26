const backendClient = require("./backendClient");
const pollComponent = require("../components/poll");
const groupRankingService = require("./groupRankingService");
const logger = require("../utils/logger");

/**
 * Ask user in private whether they want to add the workout to other groups
 * @param {Object} client - WhatsApp client
 * @param {string} senderNumber - user's base number (e.g. '5511999999999')
 * @param {Object} stats - workout stats (not required but accepted)
 * @param {string} originalChatId - group where workout was logged
 * @param {string} displayName - optional display name for user
 * @param {string} note - optional note to attach when logging cross-group
 * @param {string} loggedAt - ISO timestamp of original log
 */
async function askUserAboutOtherGroups(
  client,
  senderNumber,
  stats,
  originalChatId,
  displayName = null,
  note = null,
  loggedAt = null,
) {
  try {
    if (!client || !senderNumber) return;

    // Build private chat id
    const userPrivateId = String(senderNumber).includes("@")
      ? senderNumber
      : `${senderNumber}@c.us`;

    const chats = await client.getChats();
    const groups = chats.filter(
      (c) => c.isGroup || String(c.id._serialized).endsWith("@g.us"),
    );

    const eligible = [];

    for (const group of groups) {
      try {
        const groupChatId = group.id._serialized;
        if (groupChatId === originalChatId) continue;

        const participants = group.participants || [];
        const cleanSender = senderNumber.replace(/@c\.us$/i, "");
        const isMember = participants.some((p) => {
          const participantNumber =
            p.id.user || p.id._serialized.replace(/@c\.us$/i, "");
          return (
            participantNumber === cleanSender ||
            participantNumber.includes(cleanSender) ||
            cleanSender.includes(participantNumber)
          );
        });
        if (!isMember) continue;

        // check group settings for workoutTrackingEnabled
        const settings = await backendClient.sendToBackend(
          `/api/workouts/groups/${encodeURIComponent(groupChatId)}/settings`,
          null,
          "GET",
        );
        if (!settings || !settings.workoutTrackingEnabled) continue;

        const name = group.name || group.formattedTitle || groupChatId;
        eligible.push({ name, chatId: groupChatId });
      } catch (e) {
        logger.debug("[workoutMultiGroup] skip group check", e && e.message);
      }
    }

    if (!eligible || eligible.length === 0) return;

    const groupMap = {};
    const options = eligible.map((g) => {
      groupMap[g.name] = g.chatId;
      return g.name;
    });
    options.push("Não");

    // Ensure poll callbacks are restored if component not initialized
    if (typeof pollComponent.setWhatsAppClient === "function") {
      pollComponent.setWhatsAppClient(client);
    }

    const registered = new Set();

    await pollComponent.createPoll(
      client,
      userPrivateId,
      "Deseja adicionar esse treino no seu outro grupo?",
      options,
      {
        options: { allowMultipleAnswers: true },
        onVote: async (payload) => {
          try {
            const selected =
              payload && payload.selectedNames ? payload.selectedNames : [];
            for (const name of selected) {
              if (!name || name === "Não") continue;
              if (registered.has(name)) continue;
              registered.add(name);

              const targetChatId = groupMap[name];
              if (!targetChatId) continue;

              // Log cross-group
              const result = await backendClient.sendToBackend(
                "/api/workouts/log-cross-group",
                {
                  senderNumber,
                  chatId: targetChatId,
                  note,
                  loggedAt,
                },
                "POST",
              );

              if (result && result.success) {
                // Notify target group
                try {
                  await client.sendMessage(
                    targetChatId,
                    result.message || "🔥 Treino registrado!",
                  );
                } catch (e) {
                  logger.error(
                    "[workoutMultiGroup] failed to send group notification",
                    e && e.message,
                  );
                }

                // Update ranking for that group
                setTimeout(() => {
                  try {
                    groupRankingService.updateGroupRanking(targetChatId);
                  } catch (e) {
                    logger.error(
                      "[workoutMultiGroup] updateGroupRanking error",
                      e && e.message,
                    );
                  }
                }, 1000);
              }
            }
          } catch (err) {
            logger.error(
              "[workoutMultiGroup] onVote handler error:",
              err && err.message,
            );
          }
        },
      },
    );
  } catch (err) {
    logger.error("[workoutMultiGroup] error:", err && err.message);
    throw err;
  }
}

module.exports = { askUserAboutOtherGroups };
