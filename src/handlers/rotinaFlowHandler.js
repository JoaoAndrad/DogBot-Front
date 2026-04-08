const conversationState = require("../services/conversationState");
const routineClient = require("../services/routineClient");
const { parseRoutineDatePtBr } = require("../utils/parseRoutineDatePtBr");
const { parseRoutineTimePtBr } = require("../utils/parseRoutineTimePtBr");
const logger = require("../utils/logger");
const polls = require("../components/poll");
const flowManager = require("../components/menu/flowManager");

async function resolveUuid(backendUrl, identifier) {
  try {
    const fetch = require("node-fetch");
    const res = await fetch(
      `${backendUrl}/api/users/by-identifier/${encodeURIComponent(identifier)}`,
    );
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.user && j.user.id ? j.user.id : null;
  } catch {
    return null;
  }
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
    const contact = await client.getContactById(partId).catch(() => null);
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

/**
 * @returns {Promise<boolean>} consumiu a mensagem
 */
function samePhone(a, b) {
  const d = (x) => String(x || "").replace(/\D/g, "");
  return d(a).length > 6 && d(b).length > 6 && d(a) === d(b);
}

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
    !samePhone(context.author, invoker)
  ) {
    return false;
  }

  const text = String(body || "").trim();

  if (step === "await_name") {
    if (!text) {
      await reply("❌ Envie um nome para a rotina.");
      return true;
    }
    data.draft = data.draft || {};
    data.draft.title = text;
    conversationState.updateData(userId, {
      ...data,
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
    conversationState.updateData(userId, {
      ...data,
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

    if (isGroup && client) {
      conversationState.updateData(userId, {
        ...data,
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
      step: "await_confirm",
    });
    const d = data.draft;
    await reply(
      `📋 *Resumo*\n• Nome: ${d.title}\n• Repetição: ${d.repeatKind}\n• Início: ${d.startDate}\n• Horário: ${Math.floor(d.anchorTimeMinutes / 60)}:${String(d.anchorTimeMinutes % 60).padStart(2, "0")}\n\nResponda *sim* ou *não* para criar.`,
    );
    return true;
  }

  if (step === "await_confirm") {
    const low = text.toLowerCase();
    if (!["sim", "s", "yes"].includes(low)) {
      conversationState.clearState(userId);
      await reply("Rotina cancelada.");
      return true;
    }
    const stNow = conversationState.getState(userId);
    const d = stNow && stNow.data && stNow.data.draft;
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    const creatorUuid = await resolveUuid(backendUrl, invoker);
    if (!creatorUuid) {
      conversationState.clearState(userId);
      await reply("❌ Utilizador não encontrado.");
      return true;
    }
    if (!d || !d.title) {
      conversationState.clearState(userId);
      await reply("❌ Dados incompletos. Comece de novo com /rotina.");
      return true;
    }
    try {
      await routineClient.createRoutine({
        chatId,
        title: d.title,
        repeatKind: d.repeatKind,
        repeatEveryN: d.repeatEveryN,
        weeklyDays: d.weeklyDays,
        monthlyDay: d.monthlyDay,
        startDate: d.startDate,
        anchorTimeMinutes: d.anchorTimeMinutes,
        createdByUserId: creatorUuid,
        assigneeUserIds: [],
      });
      conversationState.clearState(userId);
      await reply("✅ Rotina criada.");
    } catch (e) {
      logger.error("[rotina] create", e);
      await reply(`❌ Erro: ${e.message || e}`);
    }
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
  finalizeCreateFromContext,
  resolveUuid,
};
