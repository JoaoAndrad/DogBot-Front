const cron = require("node-cron");
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
      `/api/groups/${chatId}/settings`,
      null,
      "GET",
    );

    if (!settings || !settings.workoutTrackingEnabled) {
      logger.debug(`[groupRanking] Workout tracking not enabled for ${chatId}`);
      return;
    }

    // Check throttle: skip if updated less than 30 minutes ago
    if (settings.lastRankingUpdate) {
      const lastUpdate = new Date(settings.lastRankingUpdate);
      const now = new Date();
      const diffMinutes = (now - lastUpdate) / 1000 / 60;

      if (diffMinutes < 30) {
        logger.debug(
          `[groupRanking] Skipping ${chatId} - updated ${diffMinutes.toFixed(0)} minutes ago`,
        );
        return;
      }
    }

    // Get current members (WhatsApp numbers only)
    const participants = chat.participants || [];
    const memberIds = participants.map(
      (p) => p.id.user || p.id._serialized.replace(/@c\.us$/i, ""),
    );

    logger.debug(
      `[groupRanking] Updating ranking for ${chatId} with ${memberIds.length} members`,
    );

    // Fetch ranking
    const ranking = await backendClient.sendToBackend(
      `/api/workouts/ranking/${chatId}`,
      { memberIds },
      "POST",
    );

    // Fetch season history
    const history = await backendClient.sendToBackend(
      `/api/workouts/season-history/${chatId}`,
      null,
      "GET",
    );

    // Format description
    const description = formatWorkoutDescription(ranking, history);

    // Update group description
    await chat.setDescription(description);

    logger.info(`[groupRanking] Updated description for ${chatId}`);

    // Update last update timestamp
    await backendClient.sendToBackend(
      `/api/groups/${chatId}/ranking-updated`,
      { timestamp: new Date().toISOString() },
      "POST",
    );
  } catch (err) {
    logger.error(`[groupRanking] Error updating ${chatId}:`, err);
  }
}

/**
 * Format workout description with ranking and winners
 * @param {Array} ranking - Ranking array
 * @param {Object} winnersHistory - Winners history object
 * @returns {string} Formatted description
 */
function formatWorkoutDescription(ranking, winnersHistory) {
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

      // Emoji for first place
      const emoji = rank === 1 ? " 🦍" : "";

      const trophy = trophiesInGroup > 0 ? ` (${trophiesInGroup}x 🏆)` : "";

      // Annual goal progress (only if public and set)
      const goalProgress =
        yearWorkouts !== null && annualGoal !== null
          ? ` (${yearWorkouts}/${annualGoal})`
          : "";

      desc += `${rank}. ${name}${emoji}${trophy}: ${monthWorkouts}${goalProgress}\n`;
    }
  }

  desc += "\n📝 Registre me marcando + treinei";

  // WhatsApp description limit: 512 chars
  if (desc.length > 512) {
    desc = truncateDescription(
      desc,
      ranking,
      winnersHistory,
      year,
      currentMonthName,
      monthNames,
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
    const emoji = rank === 1 ? " 🦍" : "";
    const trophy = trophiesInGroup > 0 ? ` (${trophiesInGroup}x🏆)` : "";
    const goalProgress =
      yearWorkouts !== null && annualGoal !== null
        ? ` (${yearWorkouts}/${annualGoal})`
        : "";
    truncated += `${rank}. ${firstName}${emoji}${trophy}: ${monthWorkouts}${goalProgress}\n`;
  }

  truncated += "\n@Bot treinei";

  // Still too long? Remove old winner history
  if (truncated.length > 512) {
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
      const trophy = trophiesInGroup > 0 ? `(${trophiesInGroup}x🏆)` : "";
      const goalProgress =
        yearWorkouts !== null && annualGoal !== null
          ? ` (${yearWorkouts}/${annualGoal})`
          : "";
      truncated += `${rank}. ${firstName} ${trophy}: ${monthWorkouts}${goalProgress}\n`;
    }
    truncated += "\n@Bot treinei";
  }

  return truncated.substring(0, 512);
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
 * Schedule ranking updates
 */
function scheduleRankingUpdates() {
  // Run every 2 hours
  cron.schedule(
    "0 */2 * * *",
    async () => {
      await updateAllGroupRankings();
    },
    {
      timezone: "America/Sao_Paulo",
    },
  );

  logger.info(
    "[groupRanking] Periodic updates scheduled (every 2 hours, America/Sao_Paulo)",
  );
}

module.exports = {
  initialize,
  updateGroupRanking,
  updateAllGroupRankings,
  scheduleRankingUpdates,
};
