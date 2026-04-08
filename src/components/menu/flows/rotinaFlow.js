/**
 * Flow /rotina — criar/listar rotinas (grupo e DM)
 */

const { createFlow } = require("../flowBuilder");
const conversationState = require("../../../services/conversationState");
const routineClient = require("../../../services/routineClient");
const polls = require("../../poll");
const flowManager = require("../flowManager");

const WA_POLL_MAX_OPTIONS = 12;

async function resolveEditorUuid(userId) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  try {
    const fetch = require("node-fetch");
    const res = await fetch(
      `${backendUrl}/api/users/by-identifier/${encodeURIComponent(userId)}`,
    );
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.user && j.user.id ? j.user.id : null;
  } catch {
    return null;
  }
}

function truncateLabel(s, max = 130) {
  const t = String(s || "?").replace(/\n/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Envia enquete com todas as rotinas do chat (máx. 11 + Voltar = 12 opções).
 */
async function sendRoutineListPoll(ctx) {
  const uuid = await resolveEditorUuid(ctx.userId);
  if (!uuid) {
    await ctx.reply("❌ Não foi possível identificar o utilizador.");
    return;
  }
  const { routines } = await routineClient.getRoutines(ctx.chatId, uuid);
  if (!routines || !routines.length) {
    await ctx.reply("Nenhuma rotina neste chat.");
    return;
  }

  const maxRoutines = WA_POLL_MAX_OPTIONS - 1;
  const slice = routines.slice(0, maxRoutines);
  const truncated = routines.length > maxRoutines;

  const labels = slice.map((r) => {
    const flag = r.isActive ? "✓" : "⏸";
    return truncateLabel(`${flag} ${r.title || "?"}`);
  });
  labels.push("🔙 Voltar ao menu");

  const optionsMeta = slice.map((r, i) => ({
    index: i,
    label: labels[i],
    action: "exec",
    handler: "routineManagePick",
    data: { routineId: r.id, title: r.title },
  }));
  optionsMeta.push({
    index: slice.length,
    label: labels[labels.length - 1],
    action: "exec",
    handler: "routineListBackToRoot",
    data: {},
  });

  const title = truncated
    ? `📋 *Rotinas* (primeiras ${maxRoutines})`
    : "📋 *Escolha uma rotina*";

  await polls.createPoll(ctx.client, ctx.chatId, title, labels, {
    metadata: {
      actionType: "menu",
      flowId: "rotina",
      path: "/",
      userId: ctx.userId,
      options: optionsMeta,
    },
    options: { allowMultipleAnswers: false },
  });
}

const rotinaFlow = createFlow("rotina", {
  root: {
    title: "📋 *Rotinas*",
    dynamic: true,
    handler: async (ctx) => {
      const isGroup = String(ctx.chatId || "").endsWith("@g.us");
      const opts = [
        { label: "➕ Criar rotina", action: "goto", target: "/create/repeat" },
        {
          label: "📃 Exibir rotinas",
          action: "exec",
          handler: "listRoutines",
        },
        { label: "👋 Sair", action: "exec", handler: "leaveRotina" },
      ];
      return { title: isGroup ? "📋 *Rotinas* (grupo)" : "📋 *Rotinas*", options: opts };
    },
  },

  "/create/repeat": {
    title: "🔁 *Repetição*",
    options: [
      {
        label: "Todos os dias",
        action: "exec",
        handler: "pickRepeat",
        data: { repeatKind: "daily" },
      },
      {
        label: "A cada 2 dias",
        action: "exec",
        handler: "pickRepeat",
        data: { repeatKind: "everyNDays", repeatEveryN: 2 },
      },
      {
        label: "A cada 3 dias",
        action: "exec",
        handler: "pickRepeat",
        data: { repeatKind: "everyNDays", repeatEveryN: 3 },
      },
      {
        label: "Dias úteis",
        action: "exec",
        handler: "pickRepeat",
        data: { repeatKind: "weekdays" },
      },
      {
        label: "Semanal (mesmo dia da semana)",
        action: "exec",
        handler: "pickRepeat",
        data: { repeatKind: "weekly", weeklyDays: [] },
      },
      {
        label: "Semana sim, semana não",
        action: "exec",
        handler: "pickRepeat",
        data: { repeatKind: "biweekly" },
      },
      {
        label: "Mensal (dia do mês da data de início)",
        action: "exec",
        handler: "pickRepeat",
        data: { repeatKind: "monthly", monthlyDay: null },
      },
      { label: "🔙 Voltar", action: "back" },
    ],
  },

  handlers: {
    pickRepeat: async (ctx, data) => {
      const draft = {
        repeatKind: data.repeatKind,
        repeatEveryN: data.repeatEveryN,
        weeklyDays: data.weeklyDays,
        monthlyDay: data.monthlyDay,
      };
      const aliasKeys = [ctx.userId, ctx.chatId];
      const uuid = await resolveEditorUuid(ctx.userId);
      if (uuid) aliasKeys.push(uuid);
      conversationState.startFlowWithAliases(aliasKeys, "rotina", {
        step: "await_name",
        draft,
        invokerUserId: ctx.userId,
        chatId: ctx.chatId,
        isGroup: String(ctx.chatId).endsWith("@g.us"),
      });
      await ctx.reply(
        "📝 *Nome da rotina*\nEnvie o nome (só quem usou /rotina pode responder).",
      );
      return { end: true };
    },

    listRoutines: async (ctx) => {
      await sendRoutineListPoll(ctx);
      return { noRender: true };
    },

    routineManagePick: async (ctx, data) => {
      const { routineId, title } = data || {};
      if (!routineId) {
        await ctx.reply("❌ Rotina inválida.");
        return { noRender: true };
      }
      const t = truncateLabel(title || "Rotina", 80);
      const labels = [
        "⏸/▶️ Pausar ou reativar",
        "🗑️ Excluir…",
        "🔙 Voltar à lista",
      ];
      const optionsMeta = [
        {
          index: 0,
          label: labels[0],
          action: "exec",
          handler: "routineToggleActive",
          data: { routineId },
        },
        {
          index: 1,
          label: labels[1],
          action: "exec",
          handler: "routinePromptDelete",
          data: { routineId, title },
        },
        {
          index: 2,
          label: labels[2],
          action: "exec",
          handler: "routineBackToList",
          data: {},
        },
      ];
      await polls.createPoll(
        ctx.client,
        ctx.chatId,
        `⚙️ *${t}*`,
        labels,
        {
          metadata: {
            actionType: "menu",
            flowId: "rotina",
            path: "/manage",
            userId: ctx.userId,
            options: optionsMeta,
          },
          options: { allowMultipleAnswers: false },
        },
      );
      return { noRender: true };
    },

    routineToggleActive: async (ctx, data) => {
      const uuid = await resolveEditorUuid(ctx.userId);
      if (!uuid) {
        await ctx.reply("❌ Utilizador não identificado.");
        return { noRender: true };
      }
      const { routines } = await routineClient.getRoutines(ctx.chatId, uuid);
      const r = routines.find((x) => x.id === data.routineId);
      if (!r) {
        await ctx.reply("❌ Rotina não encontrada.");
        return { noRender: true };
      }
      await routineClient.patchRoutine(data.routineId, {
        editorUserId: uuid,
        isActive: !r.isActive,
      });
      await ctx.reply(
        `✅ *${truncateLabel(r.title)}* — ${r.isActive ? "pausada (não receberá novos lembretes agendados)." : "reativada."}`,
      );
      return { noRender: true };
    },

    routinePromptDelete: async (ctx, data) => {
      const t = truncateLabel(data.title || "?", 50);
      const labels = ["✅ Sim, excluir", "❌ Cancelar"];
      const optionsMeta = [
        {
          index: 0,
          label: labels[0],
          action: "exec",
          handler: "routineExecuteDelete",
          data: { routineId: data.routineId, title: data.title },
        },
        {
          index: 1,
          label: labels[1],
          action: "exec",
          handler: "routineDeleteCancel",
          data: {},
        },
      ];
      await polls.createPoll(
        ctx.client,
        ctx.chatId,
        `⚠️ Excluir *${t}*?`,
        labels,
        {
          metadata: {
            actionType: "menu",
            flowId: "rotina",
            path: "/manage/delete",
            userId: ctx.userId,
            options: optionsMeta,
          },
          options: { allowMultipleAnswers: false },
        },
      );
      return { noRender: true };
    },

    routineExecuteDelete: async (ctx, data) => {
      const uuid = await resolveEditorUuid(ctx.userId);
      if (!uuid) {
        await ctx.reply("❌ Utilizador não identificado.");
        return { noRender: true };
      }
      try {
        await routineClient.deleteRoutine(data.routineId, uuid);
        const name = truncateLabel(data.title || "—", 80);
        await ctx.reply(
          `🗑️ Rotina (*${name}*) excluída com sucesso.`,
        );
      } catch (e) {
        await ctx.reply(`❌ ${e.message || e}`);
      }
      return { noRender: true };
    },

    routineDeleteCancel: async (ctx) => {
      await ctx.reply("Ok, não excluí.");
      return { noRender: true };
    },

    routineBackToList: async (ctx) => {
      await sendRoutineListPoll(ctx);
      return { noRender: true };
    },

    routineListBackToRoot: async (ctx) => {
      await flowManager._renderNode(
        ctx.client,
        ctx.chatId,
        ctx.userId,
        "rotina",
        "/",
      );
      return { noRender: true };
    },

    leaveRotina: async (ctx) => {
      await ctx.reply("Ok.");
      return { end: true };
    },
  },
});

module.exports = rotinaFlow;
