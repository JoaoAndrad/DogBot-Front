/**
 * Flow /rotina — criar/listar rotinas (grupo e DM)
 */

const { createFlow } = require("../flowBuilder");
const conversationState = require("../../../services/conversationState");
const routineClient = require("../../../services/routineClient");

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

const rotinaFlow = createFlow("rotina", {
  root: {
    title: "📋 *Rotinas*",
    dynamic: true,
    handler: async (ctx) => {
      const isGroup = String(ctx.chatId || "").endsWith("@g.us");
      const opts = [
        { label: "➕ Criar rotina", action: "goto", target: "/create/repeat" },
        {
          label: "📃 Listar / gerir",
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
      const uuid = await resolveEditorUuid(ctx.userId);
      if (!uuid) {
        await ctx.reply("❌ Não foi possível identificar o utilizador.");
        return { end: true };
      }
      try {
        const { routines } = await routineClient.getRoutines(ctx.chatId, uuid);
        if (!routines || !routines.length) {
          await ctx.reply("Nenhuma rotina neste chat.");
          return {};
        }
        const lines = routines.map(
          (r) =>
            `• *${r.title}* (${r.repeatKind}) ${r.isActive ? "✓" : "⏸"}`,
        );
        await ctx.reply(`Rotinas:\n${lines.join("\n")}`);
      } catch (e) {
        await ctx.reply(`❌ ${e.message || e}`);
      }
      return {};
    },

    leaveRotina: async (ctx) => {
      await ctx.reply("Ok.");
      return { end: true };
    },
  },
});

module.exports = rotinaFlow;
