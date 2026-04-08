const logger = require("../utils/logger");
const routineClient = require("./routineClient");

const DEFAULT_CHECKIN_OPTIONS = ["Eu fiz", "Ainda não"];

/**
 * @param {import("whatsapp-web.js").Client} client
 * @param {string} chatId
 * @param {string} bodyText
 * @param {string[]} mentionWaIds
 */
async function sendBodyWithOptionalMentions(client, chatId, bodyText, mentionWaIds) {
  if (!bodyText) return null;
  const ids = Array.isArray(mentionWaIds) ? mentionWaIds.filter(Boolean) : [];
  if (ids.length) {
    try {
      const contacts = await Promise.all(
        ids.map((jid) => client.getContactById(jid).catch(() => null)),
      );
      const valid = contacts.filter(Boolean);
      if (valid.length) {
        return client.sendMessage(chatId, bodyText, { mentions: valid });
      }
    } catch (e) {
      logger.warn("[routineTick] mentions", e.message);
    }
  }
  return client.sendMessage(chatId, bodyText);
}

/**
 * Processa fila de dispatches devolvidos pelo backend (enquetes de check-in / retrospectiva).
 * @param {import("whatsapp-web.js").Client} client
 */
async function processRoutineTick(client) {
  try {
    const res = await routineClient.routineTick();
    const actions = res.actions || [];
    if (!actions.length) return;

    const polls = require("../components/poll");
    const dispatchIds = [];
    const waMessageIds = {};

    for (const a of actions) {
      const p = a.payload || {};
      const chatId = p.chatId || a.chatId;
      if (!chatId) continue;

      const mentionIds = p.bodyMentionWaIds || p.metadata?.bodyMentionWaIds;
      if (p.bodyText) {
        try {
          await sendBodyWithOptionalMentions(
            client,
            chatId,
            p.bodyText,
            mentionIds,
          );
        } catch (e) {
          logger.warn("[routineTick] bodyText", e.message);
        }
      }

      const title = p.title || "Rotina";
      const options = p.options || DEFAULT_CHECKIN_OPTIONS;
      const meta = p.metadata || {};

      const send = await polls.createPoll(client, chatId, title, options, {
        metadata: meta,
        options: { allowMultipleAnswers: false },
      });

      if (send && send.msgId && a.occurrenceId) {
        try {
          await routineClient.setActiveCheckinPoll(a.occurrenceId, send.msgId);
        } catch (e) {
          logger.warn("[routineTick] setActiveCheckinPoll", e.message);
        }
        dispatchIds.push(a.dispatchId);
        waMessageIds[a.dispatchId] = send.msgId;
      } else if (a.dispatchId) {
        dispatchIds.push(a.dispatchId);
      }
    }

    if (dispatchIds.length) {
      await routineClient.routineTickAck(dispatchIds, waMessageIds);
    }
  } catch (e) {
    logger.debug("[routineTick] skip or error:", e.message);
  }
}

function startRoutineTickLoop(client, intervalMs = 60000) {
  const t = setInterval(() => {
    processRoutineTick(client).catch((e) =>
      logger.warn("[routineTick]", e.message),
    );
  }, intervalMs);
  return t;
}

module.exports = { processRoutineTick, startRoutineTickLoop };
