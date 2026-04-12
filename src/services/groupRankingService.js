const backendClient = require("./backendClient");
const logger = require("../utils/logger");

let client = null; // WhatsApp client instance

/**
 * Initialize the service with WhatsApp client
 * @param {Object} whatsappClient - WhatsApp client instance
 */
function initialize(whatsappClient) {
  client = whatsappClient;
}

/**
 * Update ranking description for a specific group
 * @param {string} chatId - Group chat ID
 */
async function updateGroupRanking(chatId) {
  try {
    if (!client) {
      logger.error("[groupRanking] Client not initialized");
      return;
    }

    // Get chat
    const chat = await client.getChatById(chatId);

    // Check if tracking enabled
    const settings = await backendClient.sendToBackend(
      `/api/workouts/groups/${chatId}/settings`,
      null,
      "GET",
    );

    if (!settings || !settings.workoutTrackingEnabled) {
      logger.debug(`[groupRanking] Workout tracking not enabled for ${chatId}`);
      return;
    }

    // Get current members (WhatsApp numbers only)
    const participants = chat.participants || [];
    const memberIds = participants.map(
      (p) => p.id.user || p.id._serialized.replace(/@c\.us$/i, ""),
    );

    logger.debug(
      `[groupRanking] Updating ranking for ${chatId} with ${memberIds.length} members`,
    );

    // Log chat info for debugging
    logger.debug(`[groupRanking] Chat info:`, {
      name: chat.name,
      isGroup: chat.isGroup,
      isReadOnly: chat.isReadOnly,
      canSend: chat.canSend,
      participants_count: participants.length,
    });

    // Fetch ranking
    const ranking = await backendClient.sendToBackend(
      `/api/workouts/ranking/${chatId}`,
      { memberIds },
      "POST",
    );

    logger.debug(`[groupRanking] Ranking data:`, {
      count: ranking?.length || 0,
      sample: ranking?.[0],
    });

    // Fetch season history
    const history = await backendClient.sendToBackend(
      `/api/workouts/season-history/${chatId}`,
      null,
      "GET",
    );

    logger.debug(`[groupRanking] History data:`, {
      keys: Object.keys(history || {}),
      sample: Object.values(history || {})[0],
    });

    // Extract user-written prefix from current description (anything before the ranking block)
    const currentDescription = chat.description || "";
    const rankingMarker = /🏆[^\n]*TEMPORADA|🏆 \d{4} 🏆/;
    const markerIndex = currentDescription.search(rankingMarker);
    const userPrefix =
      markerIndex > 0
        ? currentDescription.substring(0, markerIndex).trimEnd()
        : "";

    // Reserve space for the prefix + separator so ranking fits in 512 chars
    const WHATSAPP_LIMIT = 512;
    const prefixOverhead = userPrefix ? userPrefix.length + 2 : 0; // 2 = "\n\n"
    const maxRankingLength = WHATSAPP_LIMIT - prefixOverhead;

    // Format description
    let rankingBlock;
    try {
      rankingBlock = formatWorkoutDescription(
        ranking,
        history,
        maxRankingLength,
      );
      logger.debug(
        `[groupRanking] Description formatted successfully: ${rankingBlock.length} chars`,
      );
    } catch (formatErr) {
      logger.error(`[groupRanking] Error formatting description:`, {
        message: formatErr.message,
        stack: formatErr.stack,
        ranking_length: ranking?.length,
        history_keys: Object.keys(history || {}),
      });
      throw formatErr;
    }

    // Validate description
    if (!rankingBlock || typeof rankingBlock !== "string") {
      logger.error(
        `[groupRanking] Invalid description for ${chatId}:`,
        typeof rankingBlock,
      );
      return;
    }

    // Compose final description: preserve user prefix + ranking block
    const description = userPrefix
      ? `${userPrefix}\n\n${rankingBlock}`
      : rankingBlock;

    logger.debug(
      `[groupRanking] Description length: ${description.length} chars (prefix: ${userPrefix.length})`,
    );

    // Only update if description actually changed
    if (currentDescription.trim() === description.trim()) {
      logger.debug(
        `[groupRanking] Description unchanged for ${chatId}, skipping update`,
      );
      return;
    }

    logger.debug(
      `[groupRanking] Attempting to set description for ${chatId}...`,
    );
    try {
      logger.debug(`[groupRanking] Calling chat.setDescription() now...`);
      await chat.setDescription(description);
      logger.info(`[groupRanking] Updated description for ${chatId}`);
    } catch (descErr) {
      logger.error(`[groupRanking] Failed to set description for ${chatId}:`, {
        message: descErr.message,
        name: descErr.name,
        stack: descErr.stack,
        errorString: String(descErr),
        errorJson: JSON.stringify(descErr, Object.getOwnPropertyNames(descErr)),
        description_length: description.length,
        description_preview: description.substring(0, 200),
      });
      // Continue anyway - description update is not critical
    }

    // Update last update timestamp
    await backendClient.sendToBackend(
      `/api/workouts/groups/${chatId}/ranking-updated`,
      { timestamp: new Date().toISOString() },
      "POST",
    );
  } catch (err) {
    logger.error(`[groupRanking] Error updating ${chatId}:`, {
      message: err.message,
      name: err.name,
      stack: err.stack,
      chatId: chatId,
    });
  }
}

/**
 * Format workout description with ranking and winners
 * @param {Array} ranking - Ranking array
 * @param {Object} winnersHistory - Winners history object
 * @param {number} [maxLength=512] - Maximum allowed length for the ranking block
 * @returns {string} Formatted description
 */
function formatWorkoutDescription(ranking, winnersHistory, maxLength = 512) {
  const now = new Date();
  const year = now.getFullYear();
  const monthNames = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const currentMonth = now.getMonth();
  const currentMonthName = monthNames[currentMonth];

  let desc = `🏆 TEMPORADA ${year} 🏆\n\n`;

  // Winners history
  if (winnersHistory && Object.keys(winnersHistory).length > 0) {
    desc += "📅 Vencedores:\n";

    const sortedMonths = Object.keys(winnersHistory).sort();

    for (const monthKey of sortedMonths) {
      const winners = winnersHistory[monthKey];

      // Skip if winners is not an array or is empty
      if (!Array.isArray(winners) || winners.length === 0) {
        continue;
      }

      const [month, _] = monthKey.split("/");
      const monthName = monthNames[parseInt(month) - 1];

      if (winners.length === 1) {
        desc += `${monthName}: ${winners[0].name}\n`;
      } else {
        const names = winners.map((w) => w.name).join(" e ");
        desc += `${monthName}: ${names}\n`;
      }
    }
    desc += "\n";
  }

  // Current month ranking
  desc += `📊 Placar Atual (${currentMonthName}):\n\n`;

  if (!ranking || ranking.length === 0) {
    desc += "Nenhum treino registrado ainda.\n";
  } else {
    for (const entry of ranking) {
      const {
        rank,
        name,
        trophiesInGroup,
        monthWorkouts,
        yearWorkouts,
        annualGoal,
      } = entry;

      // Medal emoji for top 3, gorilla for first place
      let prefix;
      if (rank === 1) {
        prefix = "🥇";
      } else if (rank === 2) {
        prefix = "🥈";
      } else if (rank === 3) {
        prefix = "🥉";
      } else {
        prefix = `${rank}.`;
      }

      const emoji = rank === 1 ? " 🦍" : "";

      const trophy = trophiesInGroup > 0 ? ` (${trophiesInGroup}x 🏆)` : "";

      // Annual goal progress (only if public and set)
      const goalProgress =
        yearWorkouts !== null && annualGoal !== null
          ? ` (${yearWorkouts}/${annualGoal})`
          : "";

      desc += `${prefix} ${name}${emoji}${trophy}: ${monthWorkouts}${goalProgress}\n`;
    }
  }

  desc += "\n📝 Registre me marcando + treinei ou usando /treinei";

  // Respect caller-supplied length limit
  if (desc.length > maxLength) {
    desc = truncateDescription(
      desc,
      ranking,
      winnersHistory,
      year,
      currentMonthName,
      monthNames,
      maxLength,
    );
  }

  return desc;
}

/**
 * Truncate description to fit WhatsApp limit
 * @param {string} desc - Original description
 * @param {Array} ranking - Ranking array
 * @param {Object} winnersHistory - Winners history
 * @param {number} year - Current year
 * @param {string} currentMonthName - Current month name
 * @param {Array} monthNames - Month names array
 * @returns {string} Truncated description
 */
function truncateDescription(
  desc,
  ranking,
  winnersHistory,
  year,
  currentMonthName,
  monthNames,
  maxLength = 512,
) {
  let truncated = `🏆 TEMPORADA ${year} 🏆\n\n`;

  // Winners (compact format - last 3 months only)
  if (winnersHistory && Object.keys(winnersHistory).length > 0) {
    truncated += "📅 Vencedores:\n";
    const sortedMonths = Object.keys(winnersHistory).sort();
    for (const monthKey of sortedMonths.slice(-3)) {
      const winners = winnersHistory[monthKey];
      const [month] = monthKey.split("/");
      const monthName = monthNames[parseInt(month) - 1].substring(0, 3); // Abbreviate

      const names = winners.map((w) => w.name.split(" ")[0]).join(" e "); // First names only
      truncated += `${monthName}: ${names}\n`;
    }
    truncated += "\n";
  }

  // Top 10 only
  truncated += `📊 ${currentMonthName}:\n\n`;
  const top10 = ranking.slice(0, 10);

  for (const entry of top10) {
    const {
      rank,
      name,
      trophiesInGroup,
      monthWorkouts,
      yearWorkouts,
      annualGoal,
    } = entry;
    const firstName = name.split(" ")[0];

    // Medal emoji for top 3
    let prefix;
    if (rank === 1) {
      prefix = "🥇";
    } else if (rank === 2) {
      prefix = "🥈";
    } else if (rank === 3) {
      prefix = "🥉";
    } else {
      prefix = `${rank}.`;
    }

    const emoji = rank === 1 ? " 🦍" : "";
    const trophy = trophiesInGroup > 0 ? ` (${trophiesInGroup}x🏆)` : "";
    const goalProgress =
      yearWorkouts !== null && annualGoal !== null
        ? ` (${yearWorkouts}/${annualGoal})`
        : "";
    truncated += `${prefix} ${firstName}${emoji}${trophy}: ${monthWorkouts}${goalProgress}\n`;
  }

  truncated += "\n@Bot treinei";

  // Still too long? Remove old winner history
  if (truncated.length > maxLength) {
    truncated = `🏆 ${year} 🏆\n\n📊 ${currentMonthName}:\n\n`;
    for (const entry of top10) {
      const {
        rank,
        name,
        trophiesInGroup,
        monthWorkouts,
        yearWorkouts,
        annualGoal,
      } = entry;
      const firstName = name.split(" ")[0];

      // Medal emoji for top 3
      let prefix;
      if (rank === 1) {
        prefix = "🥇";
      } else if (rank === 2) {
        prefix = "🥈";
      } else if (rank === 3) {
        prefix = "🥉";
      } else {
        prefix = `${rank}.`;
      }

      const trophy = trophiesInGroup > 0 ? `(${trophiesInGroup}x🏆)` : "";
      const goalProgress =
        yearWorkouts !== null && annualGoal !== null
          ? ` (${yearWorkouts}/${annualGoal})`
          : "";
      truncated += `${prefix} ${firstName} ${trophy}: ${monthWorkouts}${goalProgress}\n`;
    }
    truncated += "\n@Bot treinei";
  }

  return truncated.substring(0, maxLength);
}

/**
 * Update all group rankings
 */
async function updateAllGroupRankings() {
  try {
    if (!client) {
      logger.error("[groupRanking] Client not initialized");
      return;
    }

    logger.info("[groupRanking] Starting periodic ranking updates...");

    // Get all chats
    const chats = await client.getChats();
    const groups = chats.filter(
      (c) => c.isGroup || String(c.id._serialized).endsWith("@g.us"),
    );

    for (const group of groups) {
      try {
        await updateGroupRanking(group.id._serialized);

        // Throttle between groups
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        logger.error(
          `[groupRanking] Error updating group ${group.id._serialized}:`,
          error,
        );
      }
    }

    logger.info("[groupRanking] Periodic ranking updates completed");
  } catch (error) {
    logger.error("[groupRanking] Error in updateAllGroupRankings:", error);
  }
}

/**
 * No-op: ranking updates are now triggered only on explicit events
 * (workout logged/removed, system ativated).
 */
function scheduleRankingUpdates() {
  logger.info(
    "[groupRanking] Periodic cron disabled — updates run on demand only",
  );
}

module.exports = {
  initialize,
  updateGroupRanking,
  updateAllGroupRankings,
  scheduleRankingUpdates,
};
