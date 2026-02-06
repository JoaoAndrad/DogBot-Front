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
    const response = await backendClient.get(`/api/polls/${pollId}/state`);
    return response.data;
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
      logger.warn(
        `[processor] No handler registered for actionType: ${actionType}`,
      );
      // Use generic fallback handler
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
 * Logs vote results but doesn't perform any specific action
 */
async function processGenericVote(poll, votes, stats, client) {
  logger.info(`[processor] Generic vote processing for poll ${poll.id}`);
  logger.info(`[processor] Title: ${poll.title}`);
  logger.info(`[processor] Total votes: ${stats.total}`);
  logger.info(`[processor] Votes by option:`, stats.byOption);

  // For generic polls, just log the results
  // Custom handlers should be registered for polls that need specific actions
}

/**
 * Restore all active polls from backend and set up their callbacks
 * Should be called on bot startup
 * @param {Object} client - WhatsApp client instance
 * @param {Object} pollComponent - Poll component with createPoll function
 */
async function restoreAllPolls(client, pollComponent) {
  try {
    logger.info("[processor] Restoring all active polls from backend...");

    // Get all polls from backend (could filter by recent/active later)
    const response = await backendClient.get("/api/polls/");
    const polls = response.data || [];

    logger.info(`[processor] Found ${polls.length} polls to restore`);

    let restored = 0;
    for (const poll of polls) {
      try {
        const actionType = getActionType(poll);
        const handler = actionHandlers.get(actionType);

        if (!handler) {
          logger.warn(
            `[processor] Skipping poll ${poll.id} - no handler for ${actionType}`,
          );
          continue;
        }

        // Create callback that uses the processor
        const callback = async (vote) => {
          await processPollVote(poll.id, client);
        };

        // Register the callback with poll component
        pollComponent.createPoll.addCallback(poll.id, callback);
        restored++;

        logger.info(`[processor] Restored poll ${poll.id} (${actionType})`);
      } catch (err) {
        logger.error(
          `[processor] Failed to restore poll ${poll.id}:`,
          err.message,
        );
      }
    }

    logger.info(
      `[processor] Successfully restored ${restored}/${polls.length} polls`,
    );
  } catch (error) {
    logger.error("[processor] Failed to restore polls:", error.message);
  }
}

module.exports = {
  registerActionHandler,
  getPollState,
  getActionType,
  processPollVote,
  restoreAllPolls,
};
