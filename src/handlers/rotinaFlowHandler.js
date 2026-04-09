const conversationState = require("../services/conversationState");
const routineClient = require("../services/routineClient");
const { parseRoutineDatePtBr } = require("../utils/parseRoutineDatePtBr");
const { parseRoutineTimePtBr } = require("../utils/parseRoutineTimePtBr");
const logger = require("../utils/logger");
const polls = require("../components/poll");
const {
  repeatKindLabel,
  formatTimeMinutes,
  formatYmdToBr,
  formatRoutineSummaryFromApi,
} = require("../utils/formatRoutineSummaryPt");

/** UUID padrão (8-4-4-4-12) — evita falsos positivos com JIDs longos. */
const USER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeUserUuid(s) {
  return typeof s === "string" && USER_UUID_RE.test(s.trim());
}

async function resolveUuid(backendUrl, identifier) {
  try {
    const fetch = require("node-fetch");
    const id = String(identifier || "").trim();
    const url = looksLikeUserUuid(id)
      ? `${backendUrl}/api/users/${encodeURIComponent(id)}`
      : `${backendUrl}/api/users/by-identifier/${encodeURIComponent(identifier)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.user && j.user.id ? j.user.id : null;
  } catch {
    return null;
  }
}

/** Mesmo critério que confissao.js (pickParticipantFromGroup): não listar o próprio bot. */
async function getBotOwnJid(client) {
  if (!client) return null;
  try {
    if (client.info && client.info.me && client.info.me._serialized) {
      return client.info.me._serialized;
    }
    if (client.info && client.info.wid && client.info.wid._serialized) {
      return client.info.wid._serialized;
    }
    if (client.info && client.info.wid) {
      return `${client.info.wid}@c.us`;
    }
    if (typeof client.getMe === "function") {
      const me = await client.getMe();
      if (me && me._serialized) return me._serialized;
      if (me && me.id && me.id._serialized) return me.id._serialized;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function samePhone(a, b) {
  const d = (x) => String(x || "").replace(/\D/g, "");
  return d(a).length > 6 && d(b).length > 6 && d(a) === d(b);
}

async function sendAssignPoll(client, chatId, userId, draft) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const creatorUuid = await resolveUuid(backendUrl, userId);
  if (!creatorUuid) {
    await client.sendMessage(
      chatId,
      "❌ Não foi possível resolver o seu utilizador. Use /cadastro no privado.",
    );
    return;
  }

  const botJid = await getBotOwnJid(client);

  const chat = await client.getChatById(chatId);
  const participants = Array.isArray(chat.participants)
    ? chat.participants
    : [];
  const options = ["Somente a mim"];
  const indexToUserId = {};
  let idx = 1;
  for (const p of participants) {
    const partId =
      p.id && p.id._serialized ? p.id._serialized : p.id || "";
    if (!partId || partId === userId) continue;
    if (botJid && (partId === botJid || samePhone(partId, botJid))) continue;
    const contact = await client.getContactById(partId).catch(() => null);
    if (contact && contact.isMe) continue;
    const label =
      (contact && (contact.pushname || contact.name)) ||
      partId.split("@")[0] ||
      "?";
    const uuid = await resolveUuid(backendUrl, partId);
    if (!uuid) continue;
    options.push(label.slice(0, 60));
    indexToUserId[String(idx)] = uuid;
    idx += 1;
    if (options.length >= 11) break;
  }
  const continueIndex = options.length;
  options.push("Continuar");

  const title =
    "Quem entra na rotina? O criador conta sempre. Marque e *Continuar*.";

  await polls.createPoll(client, chatId, title, options, {
    metadata: {
      actionType: "rotina_assign",
      flowId: "rotina",
      userId,
      chatId,
      path: "/create/assignees",
      continueIndex,
      onlyMeIndex: 0,
      indexToUserId,
      creatorUserId: creatorUuid,
    },
    options: { allowMultipleAnswers: true },
  });
}

async function fetchUserLabel(backendUrl, userIdOrWaId) {
  if (!userIdOrWaId) return "?";
  const raw = String(userIdOrWaId).trim();
  try {
    const fetch = require("node-fetch");
    const url = looksLikeUserUuid(raw)
      ? `${backendUrl}/api/users/${encodeURIComponent(raw)}`
      : `${backendUrl}/api/users/by-identifier/${encodeURIComponent(raw)}`;
    const res = await fetch(url);
    if (!res.ok) return String(raw).slice(0, 8) + "…";
    const j = await res.json();
    const u = j && j.user;
    if (!u) return "?";
    return u.display_name || u.push_name || u.sender_number || "?";
  } catch {
    return "?";
  }
}

async function buildDraftSummaryText(backendUrl, invokerWaId, draft, isGroup) {
  const title = draft.title || "—";
  const rep = repeatKindLabel(draft);
  const start = formatYmdToBr(draft.startDate);
  const time = formatTimeMinutes(draft.anchorTimeMinutes);
  // Preferir JID do WhatsApp: GET by-identifier funciona como no fluxo de assignees; UUID em /users/:id pode falhar.
  const creatorName = await fetchUserLabel(backendUrl, invokerWaId);

  let peopleBlock = "";
  const ids = Array.isArray(draft.assigneeUserIds)
    ? draft.assigneeUserIds
    : [];
  if (!isGroup) {
    peopleBlock =
      `👤 *Criador:* *${creatorName}*\n` +
      `💬 *Participantes:* só você (chat privado).`;
  } else if (ids.length === 0) {
    peopleBlock =
      `👤 *Criador:* *${creatorName}*\n` +
      `👥 *Participantes:* *somente o criador* (opção “Somente a mim”).`;
  } else {
    const labels = await Promise.all(
      ids.map((id) => fetchUserLabel(backendUrl, id)),
    );
    peopleBlock =
      `👤 *Criador:* *${creatorName}*\n` +
      `👥 *Também na rotina:* ${labels.map((x) => `*${x}*`).join(", ")}`;
  }

  return (
    `📋 *Confirmar criação da rotina*\n\n` +
    `📝 *Nome:* *${title}*\n` +
    `🔁 *Repetição:* ${rep}\n` +
    `📅 *Início:* ${start}\n` +
    `⏰ *Horário:* ${time}\n\n` +
    `${peopleBlock}`
  );
}

async function sendPrimaryConfirmPoll(client, chatId, userId, draft, isGroup) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const summary = await buildDraftSummaryText(
    backendUrl,
    userId,
    draft,
    isGroup,
  );
  await client.sendMessage(chatId, summary);
  await polls.createPoll(
    client,
    chatId,
    "Confirmar ou editar?",
    ["✅ Confirmar criação", "✏️ Editar informação"],
    {
      metadata: {
        actionType: "rotina_wizard",
        wizardStep: "primary",
        flowId: "rotina",
        userId,
        chatId,
      },
      options: { allowMultipleAnswers: false },
    },
  );
}

async function sendEditFieldPoll(client, chatId, userId, isGroup) {
  const labels = [
    "📝 Nome",
    "📅 Data de início",
    "⏰ Horário",
    "🔁 Repetição",
  ];
  const fields = ["name", "startDate", "time", "repeat"];
  if (isGroup) {
    labels.push("👥 Participantes");
    fields.push("assignees");
  }
  await polls.createPoll(client, chatId, "O que deseja editar?", labels, {
    metadata: {
      actionType: "rotina_wizard",
      wizardStep: "edit_pick",
      editFields: fields,
      flowId: "rotina",
      userId,
      chatId,
    },
    options: { allowMultipleAnswers: false },
  });
}

const REPEAT_EDIT_LABELS = [
  "Todos os dias",
  "A cada 2 dias",
  "A cada 3 dias",
  "Dias úteis",
  "Semanal",
  "Semana sim, semana não",
  "Mensal",
];

const REPEAT_EDIT_CHOICES = [
  { repeatKind: "daily" },
  { repeatKind: "everyNDays", repeatEveryN: 2 },
  { repeatKind: "everyNDays", repeatEveryN: 3 },
  { repeatKind: "weekdays" },
  { repeatKind: "weekly", weeklyDays: [] },
  { repeatKind: "biweekly" },
  { repeatKind: "monthly", monthlyDay: null },
];

async function sendRepeatEditPoll(client, chatId, userId) {
  await polls.createPoll(
    client,
    chatId,
    "🔁 Nova repetição",
    REPEAT_EDIT_LABELS,
    {
      metadata: {
        actionType: "rotina_wizard",
        wizardStep: "repeat_pick",
        repeatChoices: REPEAT_EDIT_CHOICES,
        flowId: "rotina",
        userId,
        chatId,
      },
      options: { allowMultipleAnswers: false },
    },
  );
}

/** Enquete de dia da semana após escolher Semanal / Quinzenal na edição. */
async function sendRepeatWeekdayEditPoll(client, chatId, userId) {
  const labels = [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ];
  const weekdayLuxonByIndex = [7, 1, 2, 3, 4, 5, 6];
  await polls.createPoll(client, chatId, "🔁 Qual dia da semana?", labels, {
    metadata: {
      actionType: "rotina_wizard",
      wizardStep: "repeat_weekday_pick",
      weekdayLuxonByIndex,
      flowId: "rotina",
      userId,
      chatId,
    },
    options: { allowMultipleAnswers: false },
  });
}

function getRotinaStateKey(data) {
  return data.userId;
}

/**
 * Processador de votos rotina_wizard (chamado a partir de poll/processor).
 */
async function executeRotinaWizardAction(result, client) {
  const { action, data } = result;
  const chatId = data.chatId;
  const stateUserId = data.userId;
  if (!chatId || !stateUserId) return;

  let st = conversationState.getState(stateUserId);
  if (!st && data.chatId) st = conversationState.getState(data.chatId);
  if (!st || st.flowType !== "rotina" || !st.data || !st.data.draft) {
    await client.sendMessage(chatId, "❌ Sessão expirada. Use /rotina de novo.");
    return;
  }

  const invoker = st.data.invokerUserId || stateUserId;
  const isGroup = !!st.data.isGroup;
  const draft = st.data.draft;

  if (action === "rotina_wizard_confirm") {
    try {
      const creatorUuid = await resolveUuid(
        process.env.BACKEND_URL || "http://localhost:8000",
        invoker,
      );
      if (!creatorUuid) throw new Error("creator_not_found");
      const created = await routineClient.createRoutine({
        chatId,
        title: draft.title,
        repeatKind: draft.repeatKind,
        repeatEveryN: draft.repeatEveryN,
        weeklyDays: draft.weeklyDays || [],
        monthlyDay: draft.monthlyDay,
        startDate: draft.startDate,
        anchorTimeMinutes: draft.anchorTimeMinutes,
        createdByUserId: creatorUuid,
        assigneeUserIds: isGroup ? draft.assigneeUserIds || [] : [],
      });
      conversationState.clearState(stateUserId);
      if (data.chatId) conversationState.clearState(data.chatId);
      const msg = formatRoutineSummaryFromApi(created);
      await client.sendMessage(chatId, msg);
    } catch (e) {
      logger.error("[rotina] wizard confirm", e);
      await client.sendMessage(
        chatId,
        `❌ Erro ao criar: ${e.message || e}`,
      );
    }
    return;
  }

  if (action === "rotina_wizard_edit_menu") {
    await sendEditFieldPoll(client, chatId, stateUserId, isGroup);
    return;
  }

  if (action === "rotina_wizard_edit_field") {
    const field = data.editField;
    if (!field) {
      await client.sendMessage(chatId, "❌ Opção inválida.");
      return;
    }
    if (field === "name") {
      conversationState.updateData(stateUserId, {
        step: "await_name",
        editReturnTo: "await_final_confirm",
      });
      await client.sendMessage(chatId, "Envie o *nome* da rotina (texto).");
      return;
    }
    if (field === "startDate") {
      conversationState.updateData(stateUserId, {
        step: "await_start_date",
        editReturnTo: "await_final_confirm",
      });
      await client.sendMessage(
        chatId,
        "📅 *Nova data de início* (ex.: `DD/MM/AAAA`, `hoje`).",
      );
      return;
    }
    if (field === "time") {
      conversationState.updateData(stateUserId, {
        step: "await_time",
        editReturnTo: "await_final_confirm",
      });
      await client.sendMessage(
        chatId,
        "⏰ *Novo horário* (ex.: `08:00`, `meio dia`).",
      );
      return;
    }
    if (field === "repeat") {
      conversationState.updateData(stateUserId, {
        step: "await_repeat_edit_poll",
      });
      await sendRepeatEditPoll(client, chatId, stateUserId);
      return;
    }
    if (field === "assignees" && isGroup) {
      conversationState.updateData(stateUserId, {
        step: "await_assign_poll",
        editReturnTo: "await_final_confirm",
      });
      await sendAssignPoll(client, chatId, invoker, draft);
      await client.sendMessage(
        chatId,
        "👆 Marque quem participa e *Continuar*.",
      );
      return;
    }
    return;
  }

  if (action === "rotina_wizard_repeat_applied") {
    const ch = data.repeatChoice;
    if (!ch) return;
    const rk = ch.repeatKind;
    if (rk === "weekly" || rk === "biweekly") {
      conversationState.updateData(stateUserId, {
        pendingRepeatChoice: ch,
        step: "await_repeat_weekday_edit_poll",
      });
      await sendRepeatWeekdayEditPoll(client, chatId, stateUserId);
      return;
    }
    if (rk === "monthly") {
      const nextDraft = { ...draft, ...ch };
      conversationState.updateData(stateUserId, {
        draft: nextDraft,
        step: "await_monthly_day",
        editReturnTo: "await_final_confirm",
      });
      await client.sendMessage(
        chatId,
        "📅 *Qual dia do mês?*\nEnvie um número de *1* a *31*.",
      );
      return;
    }
    const nextDraft = { ...draft, ...ch };
    conversationState.updateData(stateUserId, {
      draft: nextDraft,
      step: "await_final_confirm",
    });
    await sendPrimaryConfirmPoll(client, chatId, stateUserId, nextDraft, isGroup);
    return;
  }

  if (action === "rotina_wizard_repeat_weekday_applied") {
    const luxonWeekday = data.luxonWeekday;
    const pending = st.data.pendingRepeatChoice;
    if (luxonWeekday == null || !pending) {
      await client.sendMessage(chatId, "❌ Opção inválida ou sessão expirada.");
      return;
    }
    const nextDraft = {
      ...draft,
      ...pending,
      weeklyDays: [luxonWeekday],
    };
    conversationState.updateData(stateUserId, {
      draft: nextDraft,
      step: "await_final_confirm",
      pendingRepeatChoice: undefined,
    });
    await sendPrimaryConfirmPoll(client, chatId, stateUserId, nextDraft, isGroup);
  }
}

async function authorMatchesInvoker(client, author, invoker) {
  if (!author || !invoker) return true;
  if (author === invoker) return true;
  if (samePhone(author, invoker)) return true;
  if (String(author).includes("@lid") && client) {
    try {
      const c = await client.getContactById(author);
      const sid = c && c.id && c.id._serialized;
      if (sid && (sid === invoker || samePhone(sid, invoker))) return true;
    } catch (e) {
      /* ignore */
    }
  }
  return false;
}

/** @returns {Promise<boolean>} consumiu a mensagem */
async function handleRotinaFlow(userId, body, state, reply, context) {
  const data = state.data || {};
  const step = data.step || state.step;
  const chatId = context?.chatId;
  const client = context?.client;
  const invoker = data.invokerUserId || userId;
  const isGroup = data.isGroup;

  if (
    invoker &&
    context.author &&
    !(await authorMatchesInvoker(client, context.author, invoker))
  ) {
    return false;
  }

  const text = String(body || "").trim();

  if (step === "await_monthly_day") {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n < 1 || n > 31) {
      await reply("❌ Envie um dia do mês entre 1 e 31.");
      return true;
    }
    data.draft = data.draft || {};
    data.draft.monthlyDay = n;
    if (data.editReturnTo === "await_final_confirm" && client) {
      conversationState.updateData(userId, {
        ...data,
        draft: data.draft,
        step: "await_final_confirm",
        editReturnTo: undefined,
      });
      await sendPrimaryConfirmPoll(client, chatId, invoker, data.draft, isGroup);
      return true;
    }
    conversationState.updateData(userId, {
      ...data,
      draft: data.draft,
      step: "await_name",
    });
    await reply(
      "📝 *Nome da rotina*\nEnvie o nome (só quem usou /rotina pode responder).",
    );
    return true;
  }

  if (step === "await_name") {
    if (!text) {
      await reply("❌ Envie um nome para a rotina.");
      return true;
    }
    data.draft = data.draft || {};
    data.draft.title = text;
    if (data.editReturnTo === "await_final_confirm" && client) {
      conversationState.updateData(userId, {
        ...data,
        draft: data.draft,
        step: "await_final_confirm",
        editReturnTo: undefined,
      });
      await sendPrimaryConfirmPoll(client, chatId, invoker, data.draft, isGroup);
      return true;
    }
    conversationState.updateData(userId, {
      ...data,
      draft: data.draft,
      step: "await_start_date",
    });
    await reply(
      "📅 *Data de início* (ex.: `DD/MM/AAAA`, `hoje`, `amanhã`).",
    );
    return true;
  }

  if (step === "await_start_date") {
    const p = parseRoutineDatePtBr(text);
    if (!p.ok) {
      await reply(`❌ ${p.reason}`);
      return true;
    }
    data.draft.startDate = p.date.toISOString().slice(0, 10);
    if (data.editReturnTo === "await_final_confirm" && client) {
      conversationState.updateData(userId, {
        ...data,
        draft: data.draft,
        step: "await_final_confirm",
        editReturnTo: undefined,
      });
      await sendPrimaryConfirmPoll(client, chatId, invoker, data.draft, isGroup);
      return true;
    }
    conversationState.updateData(userId, {
      ...data,
      draft: data.draft,
      step: "await_time",
    });
    await reply("⏰ *Horário* principal (ex.: `08:00`, `meio dia`).");
    return true;
  }

  if (step === "await_time") {
    const p = parseRoutineTimePtBr(text);
    if (!p.ok) {
      await reply(`❌ ${p.reason}`);
      return true;
    }
    data.draft.anchorTimeMinutes = p.anchorTimeMinutes;

    if (data.editReturnTo === "await_final_confirm" && client) {
      conversationState.updateData(userId, {
        ...data,
        draft: data.draft,
        step: "await_final_confirm",
        editReturnTo: undefined,
      });
      await sendPrimaryConfirmPoll(client, chatId, invoker, data.draft, isGroup);
      return true;
    }

    if (isGroup && client) {
      conversationState.updateData(userId, {
        ...data,
        draft: data.draft,
        step: "await_assign_poll",
      });
      await sendAssignPoll(client, chatId, invoker, data.draft);
      await reply(
        "👆 Marque quem participa e *Continuar* (última opção).",
      );
      return true;
    }

    conversationState.updateData(userId, {
      ...data,
      draft: data.draft,
      step: "await_final_confirm",
    });
    await sendPrimaryConfirmPoll(client, chatId, invoker, data.draft, false);
    return true;
  }

  if (
    step === "await_final_confirm" ||
    step === "await_repeat_edit_poll" ||
    step === "await_repeat_weekday_edit_poll"
  ) {
    await reply(
      "👆 Use a *enquete* acima para confirmar, editar ou escolher repetição.",
    );
    return true;
  }

  if (step === "await_assign_poll") {
    await reply(
      "Use a enquete acima para escolher responsáveis e *Continuar*.",
    );
    return true;
  }

  return false;
}

/**
 * Chamado pelo processor após rotina_assign (fluxo alternativo) — criar rotina no API
 */
async function finalizeCreateFromContext(userId, chatId, draft, assigneeUserIds) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const creatorUuid = await resolveUuid(backendUrl, userId);
  if (!creatorUuid) throw new Error("creator_not_found");

  await routineClient.createRoutine({
    chatId,
    title: draft.title,
    repeatKind: draft.repeatKind,
    repeatEveryN: draft.repeatEveryN,
    weeklyDays: draft.weeklyDays || [],
    monthlyDay: draft.monthlyDay,
    startDate: draft.startDate,
    anchorTimeMinutes: draft.anchorTimeMinutes,
    createdByUserId: creatorUuid,
    assigneeUserIds: assigneeUserIds || [],
  });
}

module.exports = {
  handleRotinaFlow,
  sendAssignPoll,
  sendPrimaryConfirmPoll,
  sendRepeatWeekdayEditPoll,
  executeRotinaWizardAction,
  finalizeCreateFromContext,
  resolveUuid,
};
