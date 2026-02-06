/**
 * Generic poll processor - handles vote processing for any poll type
 * Uses backend as source of truth to reconstruct poll state and execute actions
 */

const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

// Registry of action type handlers
const actionHandlers = new Map();

/**
 * Register a handler for a specific action type
 * @param {string} actionType - Type of action (e.g., 'spotify_track', 'confession', 'generic_vote')
 * @param {Function} handler - Handler function (poll, votes, stats, client) => Promise<void>
 */
function registerActionHandler(actionType, handler) {
  if (typeof handler !== "function") {
    throw new Error("Handler must be a function");
  }
  actionHandlers.set(actionType, handler);
  logger.info(`[processor] Registered handler for actionType: ${actionType}`);
}

/**
 * Get poll state from backend (poll + votes + statistics)
 * @param {string} pollId - Poll message ID
 * @returns {Promise<{poll, votes, stats}>}
 */
async function getPollState(pollId) {
  try {
    const data = await backendClient.sendToBackend(
      `/api/polls/${pollId}/state`,
      null,
      "GET",
    );
    return data;
  } catch (error) {
    logger.error(
      `[processor] Failed to get poll state for ${pollId}:`,
      error.message,
    );
    throw error;
  }
}

/**
 * Determine action type from poll metadata
 * @param {Object} poll - Poll object from backend
 * @returns {string} Action type
 */
function getActionType(poll) {
  // Priority 1: metadata.actionType (new standard)
  if (poll.metadata && poll.metadata.actionType) {
    return poll.metadata.actionType;
  }

  // Priority 2: vote_type field (legacy Spotify polls)
  if (poll.vote_type) {
    return poll.vote_type;
  }

  // Priority 3: Infer from metadata structure (fallback)
  if (poll.metadata) {
    if (poll.metadata.jamId && poll.metadata.trackData) {
      return "spotify_track";
    }
    if (poll.metadata.jamId && poll.metadata.tracks) {
      return "spotify_collection";
    }
    if (poll.metadata.confessionText) {
      return "confession";
    }
    if (poll.metadata.skipContext) {
      return "skip_vote";
    }
  }

  // Default: generic vote
  return "generic_vote";
}

/**
 * Process a poll vote - main entry point
 * @param {string} pollId - Poll message ID
 * @param {Object} client - WhatsApp client instance
 * @returns {Promise<void>}
 */
async function processPollVote(pollId, client) {
  try {
    logger.info(`[processor] Processing vote for poll ${pollId}`);

    // Fetch complete state from backend
    const { poll, votes, stats } = await getPollState(pollId);

    if (!poll) {
      logger.error(`[processor] Poll ${pollId} not found in backend`);
      return;
    }

    // Determine action type
    const actionType = getActionType(poll);
    logger.info(`[processor] Poll ${pollId} actionType: ${actionType}`);

    // Get handler for this action type
    const handler = actionHandlers.get(actionType);

    if (!handler) {
      // Generic votes and menu polls don't need special processing
      // They use the callback system instead
      logger.debug(
        `[processor] No handler for ${actionType} - using generic processor`,
      );
      await processGenericVote(poll, votes, stats, client);
      return;
    }

    // Execute action-specific handler
    await handler(poll, votes, stats, client);
    logger.info(
      `[processor] Successfully processed ${actionType} vote for poll ${pollId}`,
    );
  } catch (error) {
    logger.error(
      `[processor] Error processing vote for poll ${pollId}:`,
      error,
    );
    throw error;
  }
}

/**
 * Generic vote processor (fallback for unknown action types)
 * Used for menu polls and other polls managed by callback system
 */
async function processGenericVote(poll, votes, stats, client) {
  logger.debug(`[processor] Generic vote for poll ${poll.id} - ${poll.title}`);
  logger.debug(
    `[processor] ${stats.total} votes, distribution:`,
    stats.byOption,
  );

  // Generic polls are handled by the callback system
  // No additional processing needed here
}

/**
 * Restore all active polls from backend - validates they can be processed
 * Should be called on bot startup to verify poll recovery capability
 * @param {Object} client - WhatsApp client instance
 */
async function restoreAllPolls(client) {
  try {
    logger.info("[processor] Validating poll recovery from backend...");

    // Get all polls from backend (could filter by recent/active later)
    const polls = await backendClient.sendToBackend("/api/polls/", null, "GET");

    logger.debug("[processor] Backend response type:", typeof polls);
    logger.debug("[processor] Is array:", Array.isArray(polls));

    if (!Array.isArray(polls)) {
      logger.error(
        "[processor] Invalid response from backend, expected array but got:",
        typeof polls,
      );
      logger.error(
        "[processor] Response content:",
        JSON.stringify(polls).substring(0, 200),
      );
      return;
    }

    logger.info(`[processor] Found ${polls.length} total polls in database`);

    // Count polls by action type
    const pollsByType = {};
    let recoverable = 0;

    for (const poll of polls) {
      try {
        const actionType = getActionType(poll);
        pollsByType[actionType] = (pollsByType[actionType] || 0) + 1;

        const handler = actionHandlers.get(actionType);
        if (handler) {
          recoverable++;
        }
      } catch (err) {
        logger.error(
          `[processor] Failed to check poll ${poll.id}:`,
          err.message,
        );
      }
    }

    logger.info(`[processor] Poll types:`, pollsByType);
    logger.info(
      `[processor] ${recoverable}/${polls.length} polls have registered handlers`,
    );
    logger.info(
      "[processor] Poll recovery ready - votes will be processed automatically",
    );
  } catch (error) {
    logger.error("[processor] Failed to validate polls:", error.message);
    logger.error("[processor] Stack trace:", error.stack);
    logger.error("[processor] Full error:", error);
  }
}

module.exports = {
  registerActionHandler,
  getPollState,
  getActionType,
  processPollVote,
  restoreAllPolls,
};
