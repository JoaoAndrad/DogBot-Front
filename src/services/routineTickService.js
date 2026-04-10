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
      // Prefer JIDs (evita aviso de depreciação de array de Contact em versões recentes)
      return client.sendMessage(chatId, bodyText, { mentions: ids });
    } catch (e) {
      logger.warn("[routineTick] mentions (JID)", e.message);
    }
    try {
      const contacts = await Promise.all(
        ids.map((jid) => client.getContactById(jid).catch(() => null)),
      );
      const valid = contacts.filter(Boolean);
      if (valid.length) {
        return client.sendMessage(chatId, bodyText, { mentions: valid });
      }
    } catch (e2) {
      logger.warn("[routineTick] mentions (Contact)", e2.message);
    }
  }
  return client.sendMessage(chatId, bodyText);
}

/**
 * Chave de dedupe: por ocorrência há vários `checkin_poll` (slots do dia); cada um tem
 * `metadata.checkinSlotMinute` no payload. Sem o minuto, só a primeira enquete era enviada.
 */
function routineDispatchDedupeKey(a) {
  if (!a.routineId || !a.occurrenceId) return null;
  if (a.kind === "checkin_poll") {
    const slot = a.payload?.metadata?.checkinSlotMinute;
    if (slot != null && Number.isFinite(Number(slot))) {
      return `${a.routineId}|${a.occurrenceId}|checkin_poll|${Number(slot)}`;
    }
    return `${a.routineId}|${a.occurrenceId}|checkin_poll|id:${a.dispatchId || "?"}`;
  }
  if (a.kind === "checkin_poll_group") {
    return `${a.dispatchId || "?"}|checkin_poll_group`;
  }
  if (a.kind === "retrospective") {
    return `${a.routineId}|${a.occurrenceId}|retrospective`;
  }
  return null;
}

/**
 * Evita dois dispatches realmente duplicados no mesmo tick (ex.: mesma linha na BD duas vezes).
 */
function dedupeRoutineDispatchActions(actions) {
  const primary = [];
  /** @type {Map<string, string[]>} */
  const extraDispatchIdsByKey = new Map();
  const seenOccurrenceKind = new Set();

  for (const a of actions) {
    const key = routineDispatchDedupeKey(a);
    if (!key) {
      primary.push({ action: a, key: null });
      continue;
    }
    if (!seenOccurrenceKind.has(key)) {
      seenOccurrenceKind.add(key);
      primary.push({ action: a, key });
    } else {
      if (!extraDispatchIdsByKey.has(key)) extraDispatchIdsByKey.set(key, []);
      if (a.dispatchId) extraDispatchIdsByKey.get(key).push(a.dispatchId);
      logger.warn(
        `[routineTick] dispatch duplicado ignorado no envio (ack será unificado): ${key}`,
      );
    }
  }
  return { primary, extraDispatchIdsByKey };
}

/**
 * Log agregado com nomes de grupo (WhatsApp) e resumo das ações. Opt-in: ROUTINE_TICK_SNAPSHOT_LOG=1.
 * @param {import("whatsapp-web.js").Client} client
 * @param {unknown[]} actions
 */
async function logRoutineTickSnapshotIfEnabled(client, actions) {
  if (
    process.env.ROUTINE_TICK_SNAPSHOT_LOG !== "1" &&
    process.env.ROUTINE_TICK_SNAPSHOT_LOG !== "true"
  ) {
    return;
  }
  const chatIds = [
    ...new Set(
      actions
        .map((a) => {
          const p = a && a.payload ? a.payload : {};
          return p.chatId || (a && a.chatId);
        })
        .filter(Boolean),
    ),
  ];
  const chatLabels = [];
  for (const id of chatIds) {
    try {
      const chat = await client.getChatById(id);
      const name = chat && chat.name ? String(chat.name).trim() : "";
      chatLabels.push(`${id} → ${name || id}`);
    } catch (e) {
      logger.debug("[routineTick] snapshot getChatById", id, e && e.message);
      chatLabels.push(`${id} → (erro)`);
    }
  }
  const lines = actions.map((a) => {
    const p = a && a.payload ? a.payload : {};
    const chatId = p.chatId || a.chatId || "?";
    const title = p.title || "—";
    const k = a && a.kind ? a.kind : "?";
    return `  • [${k}] "${title}" chat=${chatId}`;
  });
  logger.info(
    `[routineTick] snapshot (${actions.length} ação/ões)\nChats: ${chatLabels.join(" | ")}\n${lines.join("\n")}`,
  );
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

    await logRoutineTickSnapshotIfEnabled(client, actions);

    const polls = require("../components/poll");
    const dispatchIds = [];
    const waMessageIds = {};
    /** @type {Map<string, string>} */
    const keyToMsgId = new Map();

    const { primary, extraDispatchIdsByKey } = dedupeRoutineDispatchActions(actions);

    for (const { action: a, key: dispatchKey } of primary) {
      const p = a.payload || {};
      const chatId = p.chatId || a.chatId;
      if (!chatId) continue;

      const isGroup = a.kind === "checkin_poll_group";

      const preamble = p.preambleText || null;
      const preambleMentions =
        p.preambleMentionWaIds || p.metadata?.preambleMentionWaIds;

      const mentionIds = p.bodyMentionWaIds || p.metadata?.bodyMentionWaIds;
      if (preamble) {
        try {
          await sendBodyWithOptionalMentions(
            client,
            chatId,
            preamble,
            preambleMentions,
          );
        } catch (e) {
          logger.warn("[routineTick] preambleText", e.message);
        }
      } else if (p.bodyText) {
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
        options: { allowMultipleAnswers: !!isGroup },
      });

      const occIds =
        isGroup && Array.isArray(meta.occurrenceIds)
          ? meta.occurrenceIds
          : a.occurrenceId
            ? [a.occurrenceId]
            : [];

      if (send && send.msgId && occIds.length) {
        for (const oid of occIds) {
          try {
            await routineClient.setActiveCheckinPoll(oid, send.msgId);
          } catch (e) {
            logger.warn("[routineTick] setActiveCheckinPoll", e.message);
          }
        }
        dispatchIds.push(a.dispatchId);
        waMessageIds[a.dispatchId] = send.msgId;
        if (dispatchKey) keyToMsgId.set(dispatchKey, send.msgId);
      } else if (a.dispatchId) {
        dispatchIds.push(a.dispatchId);
        if (send && send.msgId) waMessageIds[a.dispatchId] = send.msgId;
      }
    }

    for (const [dupKey, ids] of extraDispatchIdsByKey) {
      const msgId = keyToMsgId.get(dupKey);
      if (!msgId) continue;
      for (const dispatchId of ids) {
        dispatchIds.push(dispatchId);
        waMessageIds[dispatchId] = msgId;
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
