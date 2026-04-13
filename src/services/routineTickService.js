const logger = require("../utils/logger");
const routineClient = require("./routineClient");

const DEFAULT_CHECKIN_OPTIONS = ["Eu fiz", "Ainda não", "Adiar"];

/** HH:mm a partir de minutos desde meia-noite (alinhado ao payload da rotina). */
function minutesToClockLabel(minute) {
  const m = Number(minute);
  if (!Number.isFinite(m)) return "";
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Resolve nomes de conversa para log (sem expor JID como título principal).
 * @param {import("whatsapp-web.js").Client} client
 * @param {string[]} chatIds
 */
async function fetchChatDisplayNames(client, chatIds) {
  const map = new Map();
  const unique = [...new Set((chatIds || []).filter(Boolean))];
  for (const id of unique) {
    const sid = String(id);
    try {
      const ch = await client.getChatById(sid);
      const n = ch && ch.name ? String(ch.name).trim() : "";
      if (n) {
        map.set(sid, n);
      } else if (sid.endsWith("@g.us")) {
        map.set(sid, "Grupo (nome indisponível)");
      } else {
        map.set(sid, "Privada");
      }
    } catch {
      map.set(sid, sid.endsWith("@c.us") ? "Privada" : "Grupo");
    }
  }
  return map;
}

function collectMentionJidsFromPayload(p) {
  const pre = p.preambleMentionWaIds || p.metadata?.preambleMentionWaIds;
  const body = p.bodyMentionWaIds || p.metadata?.bodyMentionWaIds;
  const a = [...(Array.isArray(pre) ? pre : []), ...(Array.isArray(body) ? body : [])];
  return [...new Set(a.map(String))];
}

function jidsToPhoneList(jids) {
  if (!jids.length) return "nenhuma (só texto)";
  return jids.map((j) => String(j).replace(/@c\.us$/i, "")).join(", ");
}

/**
 * Texto curto: data/slot ou modo retrospectiva.
 * @param {object} a ação do tick (kind + payload)
 */
function describeRoutineTiming(a) {
  const p = a.payload || {};
  const meta = p.metadata || {};
  if (a.kind === "checkin_poll_group") {
    const n = Array.isArray(meta.occurrenceIds) ? meta.occurrenceIds.length : 0;
    const slot = meta.groupSlotLabel ? String(meta.groupSlotLabel).trim() : "";
    return `várias rotinas (${n}) no mesmo intervalo${slot ? ` · janela/slot: ${slot}` : ""}`;
  }
  if (a.kind === "checkin_poll") {
    const ld = meta.localDate ? String(meta.localDate) : "";
    const hm =
      meta.checkinSlotMinute != null
        ? minutesToClockLabel(meta.checkinSlotMinute)
        : "";
    if (ld && hm) return `dia ${ld} · horário do slot ${hm}`;
    if (ld) return `dia ${ld}`;
    return "—";
  }
  if (a.kind === "retrospective") {
    return meta.localDate ? `retrospectiva · dia ${meta.localDate}` : "retrospectiva";
  }
  return "—";
}

/**
 * Log visível no terminal (independente do nível do winston).
 * Agregação no backend: vários check-in no mesmo grupo + mesma janela temporal → um único
 * dispatch `checkin_poll_group` (ver mergeOverlappingCheckinDispatches no routineService).
 */
function logRoutineTickDispatchConsole({
  serverTime,
  chatDisplayName,
  chatKind,
  actionKind,
  timingText,
  mentionPhones,
  aggregationNote,
}) {
  console.log(
    [
      `  Hora de referência (servidor): ${serverTime || "—"}`,
      `  O quê: ${actionKind}`,
      `  Quando (rotina / slot): ${timingText}`,
      `  Para: «${chatDisplayName}» (${chatKind})`,
      `  Menções (@ número): ${mentionPhones}`,
      `  Modo: ${aggregationNote}`,
    ].join("\n"),
  );
}

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
 * Processa `actions` já calculadas pelo backend (push HTTP ou fluxo legacy após tick).
 * @param {import("whatsapp-web.js").Client} client
 * @param {{ actions?: unknown[]; serverTime?: string }} res
 */
async function processRoutineTickPayload(client, res) {
  const actions = Array.isArray(res.actions) ? res.actions : [];
  if (!actions.length) return;

  await logRoutineTickSnapshotIfEnabled(client, actions);

  const polls = require("../components/poll");
  const dispatchIds = [];
  const waMessageIds = {};
  /** @type {Map<string, string>} */
  const keyToMsgId = new Map();

  const { primary, extraDispatchIdsByKey } = dedupeRoutineDispatchActions(actions);

  const primaryChatIds = primary
    .map(({ action: a }) => {
      const p = a.payload || {};
      return p.chatId || a.chatId;
    })
    .filter(Boolean);
  const chatNameById = await fetchChatDisplayNames(client, primaryChatIds);

  for (const { action: a, key: dispatchKey } of primary) {
    const p = a.payload || {};
    const chatId = p.chatId || a.chatId;
    if (!chatId) continue;

    const isGroup = a.kind === "checkin_poll_group";
    const meta = p.metadata || {};
    const mentionJids = collectMentionJidsFromPayload(p);
    const mentionPhones = jidsToPhoneList(mentionJids);
    const timingText = describeRoutineTiming(a);
    const chatDisplayName = chatNameById.get(String(chatId)) || "—";
    const chatKind = String(chatId).endsWith("@g.us") ? "grupo" : "privado";

    let actionKind = "Check-in";
    let aggregationNote =
      "Uma enquete para esta rotina (sem agregação com outras neste envio).";
    if (a.kind === "checkin_poll_group") {
      const n = Array.isArray(meta.occurrenceIds) ? meta.occurrenceIds.length : 0;
      actionKind = "Check-in agrupado";
      aggregationNote =
        n > 1
          ? `Uma só enquete para ${n} rotinas — o backend já agregou vários check-ins no mesmo grupo e na mesma janela temporal (mergeOverlappingCheckinDispatches).`
          : "Enquete agrupada (metadados de grupo).";
    } else if (a.kind === "retrospective") {
      actionKind = "Retrospectiva";
      aggregationNote =
        "Uma enquete de retrospectiva (dia anterior sem conclusão).";
    }

    logRoutineTickDispatchConsole({
      serverTime: res && res.serverTime,
      chatDisplayName,
      chatKind,
      actionKind,
      timingText,
      mentionPhones,
      aggregationNote,
    });

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
}

/**
 * Polling legacy: pede tick ao backend e processa o payload.
 * @param {import("whatsapp-web.js").Client} client
 */
async function processRoutineTick(client) {
  try {
    const res = await routineClient.routineTick();
    await processRoutineTickPayload(client, res);
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

module.exports = {
  processRoutineTick,
  processRoutineTickPayload,
  startRoutineTickLoop,
};
