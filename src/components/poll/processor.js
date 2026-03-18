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
 * Process a poll vote via backend (NEW approach)
 * Backend interprets metadata and returns action to execute
 * @param {string} pollId - Poll message ID
 * @param {Object} vote - Vote event from WhatsApp
 * @param {Object} client - WhatsApp client instance
 * @returns {Promise<void>}
 */
async function processVoteViaBackend(pollId, vote, client) {
  try {
    logger.info(`[processor] Processing vote via backend for poll ${pollId}`);

    // Extract voter ID
    let voterId =
      vote.voter ||
      vote.voterId ||
      (vote.author && vote.author.id) ||
      (vote.voter && vote.voter._serialized) ||
      "unknown";

    // Extract selected index
    const selectedOptions = vote.selectedOptions || vote.selected || [];
    let selectedIndex = null;

    if (Array.isArray(selectedOptions) && selectedOptions.length > 0) {
      const first = selectedOptions[0];
      if (typeof first === "object") {
        selectedIndex =
          first.localId != null ? first.localId : first.local_id || null;
      } else {
        selectedIndex = Number(first);
      }
    }

    if (selectedIndex === null || selectedIndex === undefined) {
      logger.warn(`[processor] No selected index found in vote for ${pollId}`);
      return;
    }

    // Call backend to process vote
    const result = await backendClient.sendToBackend(
      `/api/polls/${pollId}/process-vote`,
      { voterId, selectedIndex },
      "POST",
    );

    logger.info(
      `[processor] Backend returned action: ${result.action}`,
      result.handler || result.target || "",
    );

    // Execute action based on backend response
    await executeAction(result, client);
  } catch (error) {
    logger.error(
      `[processor] Error processing vote via backend for ${pollId}:`,
      error.message,
    );
  }
}

/**
 * Execute action returned by backend
 * @param {Object} result - Result from backend processVote
 * @param {Object} client - WhatsApp client instance
 */
async function executeAction(result, client) {
  const { action, actionType, poll, handler, target, data } = result;

  logger.debug(`[processor] executeAction received:`, {
    action,
    actionType,
    handler,
    target,
    dataKeys: data ? Object.keys(data) : [],
  });

  try {
    // Get chat
    const chat = await client.getChatById(poll.chatId);

    switch (actionType) {
      case "menu_spotify":
      case "menu":
        // State is keyed by the flow owner (who started the flow). Prefer data.userId from
        // backend so any user can vote without "session expired" when voter !== owner.
        const stateUserId =
          data.userId != null ? data.userId : result.voterId;
        // Resolve voter to @c.us (or UUID for list flows) for handler/API use.
        let menuUserId = result.voterId || data.userId;

        // Resolver o userId para obter @c.us ao invés de @lid
        try {
          const msg = await chat.fetchMessages({ limit: 50 });
          const voteMsg = msg.find(
            (m) => m.author === result.voterId || m.from === result.voterId,
          );
          if (voteMsg) {
            const contact = await voteMsg.getContact();
            if (contact && contact.id && contact.id._serialized) {
              menuUserId = contact.id._serialized;
              logger.debug(
                `[processor] Resolved voter ${result.voterId} to ${menuUserId}`,
              );
            }
          }
        } catch (err) {
          logger.warn(
            `[processor] Could not resolve voter contact:`,
            err.message,
          );
        }

        // For flows that call backend APIs with userId (MovieRating, lists), resolve to backend User UUID
        if (
          data.flowId === "add-film" ||
          data.flowId === "lists" ||
          data.flowId === "film-card" ||
          data.flowId === "film-search"
        ) {
          try {
            logger.debug(
              `[processor] Resolving user to UUID for ${data.flowId}: ${menuUserId}`,
            );
            const fetch = require("node-fetch");
            const backendUrl =
              process.env.BACKEND_URL || "http://localhost:8000";
            const lookupRes = await fetch(
              `${backendUrl}/api/users/by-identifier/${encodeURIComponent(menuUserId)}`,
              { method: "GET" },
            );

            if (lookupRes.ok) {
              const lookupData = await lookupRes.json();
              if (lookupData.success && lookupData.user && lookupData.user.id) {
                const resolvedUUID = lookupData.user.id;
                logger.info(
                  `[processor] Resolved identifier ${menuUserId} to UUID ${resolvedUUID} for ${data.flowId}`,
                );
                menuUserId = resolvedUUID;
              }
            } else {
              logger.warn(
                `[processor] Could not resolve user to UUID: status ${lookupRes.status}`,
              );
            }
          } catch (err) {
            logger.warn(`[processor] Error resolving user UUID:`, err.message);
            // Continue with current menuUserId if UUID resolution fails
          }
        }

        logger.debug(`[processor] Menu action data:`, {
          flowId: data.flowId,
          path: data.path,
          stateUserId,
          menuUserId,
          handler,
          target,
        });

        // "back" action: pop history and re-render previous node (state lives in frontend)
        // stateUserId is already flow owner (data.userId) so use it for state key
        if (action === "back") {
          const flowManager = require("../menu/flowManager");
          const storage = require("../menu/storage");
          const stateKey = stateUserId;
          const savedState = await storage.getState(stateKey, data.flowId);
          if (!savedState) {
            logger.warn(
              `[processor] No state for back (key ${stateKey}); rendering root`,
            );
            await flowManager._renderNode(
              client,
              poll.chatId,
              stateKey,
              data.flowId,
              "/",
            );
            break;
          }
          const prevPath = savedState.history?.length
            ? savedState.history.pop()
            : "/";
          savedState.path = prevPath;
          await storage.saveState(stateKey, data.flowId, savedState);
          logger.info(
            `[processor] Back to ${prevPath} for ${data.flowId} (user ${stateKey})`,
          );
          await flowManager._renderNode(
            client,
            poll.chatId,
            stateKey,
            data.flowId,
            prevPath,
          );
          break;
        }

        if (handler) {
          logger.info(
            `[processor] Executing menu handler: ${handler} for user ${menuUserId}`,
          );
          // Execute handler directly by getting flow from flowManager
          const flowManager = require("../menu/flowManager");
          const storage = require("../menu/storage");
          const flow = flowManager.flows.get(data.flowId);

          if (flow && flow.handlers && flow.handlers[handler]) {
            // Load state by the userId that started the flow (metadata), not the resolved voter,
            // so we find the correct context (e.g. film-card filmTitle/tmdbId).
            const savedState = (await storage.getState(
              stateUserId,
              data.flowId,
            )) || {
              path: "/",
              history: [],
              context: {},
            };

            // Create context expected by handlers
            const ctx = {
              userId: menuUserId,
              chatId: poll.chatId,
              client,
              reply: (text) => client.sendMessage(poll.chatId, text),
              flowId: data.flowId,
              state: savedState,
              data: data,
            };

            // Execute handler with context
            const result = await flow.handlers[handler](ctx, data);

            // Check if flow should end
            if (result && result.end) {
              const storage = require("../menu/storage");
              try {
                await storage.deleteState(stateUserId, data.flowId);
                logger.info(
                  `[processor] Flow ${data.flowId} ended for ${stateUserId} - state cleaned up`,
                );
              } catch (cleanupErr) {
                // Log cleanup failure but don't mask the successful flow completion
                logger.warn(
                  `[processor] Failed to clean up state for ${data.flowId}/${stateUserId}:`,
                  cleanupErr.message,
                );
              }
            } else {
              // Handler completed but flow continues (end: false)
              // Save updated state and re-render if path changed (use stateUserId so next vote finds same state)
              const flowManager = require("../menu/flowManager");
              if (ctx.state && ctx.state.path) {
                try {
                  logger.info(
                    `[processor] Saving state and navigating to ${ctx.state.path}`,
                  );
                  await storage.saveState(stateUserId, data.flowId, ctx.state);

                  if (result && result.noRender) {
                    logger.info(
                      `[processor] noRender=true for ${data.flowId}; skipping re-render`,
                    );
                    break;
                  }

                  // Re-render the new menu path (stateUserId so next poll metadata matches state key)
                  await flowManager._renderNode(
                    client,
                    poll.chatId,
                    stateUserId,
                    data.flowId,
                    ctx.state.path,
                  );
                } catch (stateErr) {
                  logger.error(
                    `[processor] Error saving state or rendering:`,
                    stateErr.message,
                  );
                }
              }
            }
          } else {
            logger.warn(
              `[processor] Handler ${handler} not found in flow ${data.flowId}`,
            );
          }
        } else if (target) {
          logger.info(
            `[processor] Navigating to: ${target} for user ${stateUserId}`,
          );
          const flowManager = require("../menu/flowManager");
          // Navigate to target path by re-rendering (stateUserId so poll metadata matches state)
          await flowManager._renderNode(
            client,
            poll.chatId,
            stateUserId,
            data.flowId,
            target,
          );
        }
        break;

      case "spotify_track":
        // Use existing Spotify track handler
        const trackHandler = actionHandlers.get("spotify_track");
        if (trackHandler) {
          try {
            const {
              poll: pollData,
              votes,
              stats,
            } = await getPollState(result.pollId);
            await trackHandler(pollData, votes, stats, client);
          } catch (error) {
            logger.error(`[processor] Error in spotify_track handler:`, error);
            const chat = await client.getChatById(poll.chatId);
            await chat.sendMessage(
              `⚠️ Erro ao processar votação de música. Tente novamente.`,
            );
          }
        }
        break;

      case "spotify_collection":
        // Use existing Spotify collection handler
        const collectionHandler = actionHandlers.get("spotify_collection");
        if (collectionHandler) {
          try {
            const {
              poll: pollData,
              votes,
              stats,
            } = await getPollState(result.pollId);
            await collectionHandler(pollData, votes, stats, client);
          } catch (error) {
            logger.error(
              `[processor] Error in spotify_collection handler:`,
              error,
            );
            const chat = await client.getChatById(poll.chatId);
            await chat.sendMessage(
              `⚠️ Erro ao processar votação de coleção. Tente novamente.`,
            );
          }
        }
        break;

      case "confession":
        // Confession approval/rejection
        logger.info(
          `[processor] Confession ${data.approved ? "approved" : "rejected"}`,
        );
        // TODO: Implement confession handler
        break;

      default:
        logger.debug(`[processor] Generic action: ${action}`);
        break;
    }
  } catch (error) {
    logger.error(`[processor] Error executing action ${action}:`, error);
  }
}

/**
 * Process a poll vote - main entry point (OLD approach - for Spotify polls)
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
  processVoteViaBackend,
  restoreAllPolls,
};
