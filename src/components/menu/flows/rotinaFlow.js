/**
 * Flow /rotina — criar/listar rotinas (grupo e DM)
 */

const { createFlow } = require("../flowBuilder");
const conversationState = require("../../../services/conversationState");
const routineClient = require("../../../services/routineClient");
const polls = require("../../poll");
const flowManager = require("../flowManager");
const { routineApiToDraft, sendEditFieldPoll } = require("../../../handlers/rotinaFlowHandler");

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
        label: "Semanal",
        action: "exec",
        handler: "goWeekdayPick",
        data: { repeatKind: "weekly" },
      },
      {
        label: "Semana sim, semana não",
        action: "exec",
        handler: "goWeekdayPick",
        data: { repeatKind: "biweekly" },
      },
      {
        label: "Mensal",
        action: "exec",
        handler: "pickRepeatMonthly",
        data: {},
      },
      { label: "🔙 Voltar", action: "back" },
    ],
  },

  "/create/weekday": {
    title: "📅 *Dia da semana*",
    dynamic: true,
    handler: async (ctx) => {
      const pending = ctx.state?.context?.pendingRepeatKind;
      if (!pending || (pending !== "weekly" && pending !== "biweekly")) {
        return {
          title: "❌ Contexto perdido. Use o comando /rotina de novo.",
          skipPoll: true,
        };
      }
      const dayOpts = [
        {
          label: "Domingo",
          action: "exec",
          handler: "confirmWeekdayAndStartWizard",
          data: { luxonWeekday: 7 },
        },
        {
          label: "Segunda-feira",
          action: "exec",
          handler: "confirmWeekdayAndStartWizard",
          data: { luxonWeekday: 1 },
        },
        {
          label: "Terça-feira",
          action: "exec",
          handler: "confirmWeekdayAndStartWizard",
          data: { luxonWeekday: 2 },
        },
        {
          label: "Quarta-feira",
          action: "exec",
          handler: "confirmWeekdayAndStartWizard",
          data: { luxonWeekday: 3 },
        },
        {
          label: "Quinta-feira",
          action: "exec",
          handler: "confirmWeekdayAndStartWizard",
          data: { luxonWeekday: 4 },
        },
        {
          label: "Sexta-feira",
          action: "exec",
          handler: "confirmWeekdayAndStartWizard",
          data: { luxonWeekday: 5 },
        },
        {
          label: "Sábado",
          action: "exec",
          handler: "confirmWeekdayAndStartWizard",
          data: { luxonWeekday: 6 },
        },
        { label: "🔙 Voltar", action: "back" },
      ];
      return {
        title: "📅 *Em que dia da semana se repete?*",
        options: dayOpts,
      };
    },
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

    goWeekdayPick: async (ctx, data) => {
      ctx.state.context = ctx.state.context || {};
      ctx.state.context.pendingRepeatKind = data.repeatKind;
      ctx.state.history = ctx.state.history || [];
      ctx.state.history.push(ctx.state.path || "/create/repeat");
      ctx.state.path = "/create/weekday";
      return {};
    },

    confirmWeekdayAndStartWizard: async (ctx, data) => {
      const rk = ctx.state?.context?.pendingRepeatKind;
      const luxonWeekday = data.luxonWeekday;
      if (
        !rk ||
        (rk !== "weekly" && rk !== "biweekly") ||
        luxonWeekday == null
      ) {
        await ctx.reply("❌ Contexto perdido. Use /rotina de novo.");
        return { end: true };
      }
      const draft = {
        repeatKind: rk,
        weeklyDays: [luxonWeekday],
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

    pickRepeatMonthly: async (ctx) => {
      const draft = {
        repeatKind: "monthly",
        monthlyDay: null,
      };
      const aliasKeys = [ctx.userId, ctx.chatId];
      const uuid = await resolveEditorUuid(ctx.userId);
      if (uuid) aliasKeys.push(uuid);
      conversationState.startFlowWithAliases(aliasKeys, "rotina", {
        step: "await_monthly_day",
        draft,
        invokerUserId: ctx.userId,
        chatId: ctx.chatId,
        isGroup: String(ctx.chatId).endsWith("@g.us"),
      });
      await ctx.reply(
        "📅 *Qual dia do mês?*\nEnvie um número de *1* a *31* (só quem usou /rotina pode responder).",
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
        "✅ Realizada hoje",
        "✏️ Editar…",
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
          handler: "routineMarkDoneToday",
          data: { routineId },
        },
        {
          index: 2,
          label: labels[2],
          action: "exec",
          handler: "routineStartEdit",
          data: { routineId, title },
        },
        {
          index: 3,
          label: labels[3],
          action: "exec",
          handler: "routinePromptDelete",
          data: { routineId, title },
        },
        {
          index: 4,
          label: labels[4],
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

    routineMarkDoneToday: async (ctx, data) => {
      const uuid = await resolveEditorUuid(ctx.userId);
      if (!uuid) {
        await ctx.reply("❌ Utilizador não identificado.");
        return { noRender: true };
      }
      try {
        const out = await routineClient.completeRoutineToday(
          data.routineId,
          uuid,
        );
        if (out.kind === "already_completed") {
          let msg =
            "ℹ️ Já estava registado como concluído para este período.";
          if (out.nextDueYmd) {
            msg += `\n⏭️ Próximo dia previsto: ${out.nextDueYmd}`;
          }
          await ctx.reply(msg);
          return { noRender: true };
        }
        const bits = [];
        if (out.kind === "anticipation") {
          bits.push(
            "Conta como conclusão antecipada do próximo dia previsto (sem novo lembrete nesse dia).",
          );
        } else if (out.kind === "late") {
          bits.push("Registou conclusão em atraso face ao dia previsto.");
        } else if (out.kind === "same_day") {
          bits.push("Registou como feito no dia previsto.");
        }
        let msg = `✅ *Rotina*\n\n${bits.join(" ")}\n`;
        if (out.satisfiedDueYmd) {
          msg += `\n📅 Ocorrência satisfeita: ${out.satisfiedDueYmd}`;
        }
        if (out.reportedYmd && out.reportedYmd !== out.satisfiedDueYmd) {
          msg += `\n📝 Data do registo: ${out.reportedYmd}`;
        }
        if (out.nextDueYmd) {
          msg += `\n⏭️ Próximo dia previsto: ${out.nextDueYmd}`;
        }
        await ctx.reply(msg);
      } catch (e) {
        const err = String((e && e.message) || e);
        if (err.includes("no_upcoming_due")) {
          await ctx.reply(
            "❌ Não há próximo dia previsto para esta rotina no calendário.",
          );
        } else {
          await ctx.reply(`❌ ${err}`);
        }
      }
      return { noRender: true };
    },

    routineStartEdit: async (ctx, data) => {
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
      const draft = routineApiToDraft(r);
      const aliasKeys = [ctx.userId, ctx.chatId];
      aliasKeys.push(uuid);
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      conversationState.startFlowWithAliases(aliasKeys, "rotina_edit", {
        step: "await_final_confirm",
        routineId: r.id,
        draft,
        invokerUserId: ctx.userId,
        chatId: ctx.chatId,
        isGroup,
      });
      await sendEditFieldPoll(
        ctx.client,
        ctx.chatId,
        ctx.userId,
        isGroup,
        true,
      );
      await ctx.reply(
        "👆 Escolha o que deseja alterar na enquete acima.",
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
