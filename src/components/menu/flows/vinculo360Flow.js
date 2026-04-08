/**
 * Flow /vinculo360 — círculo → membro → confirmar vínculo com User (privado).
 */

const { createFlow } = require("../flowBuilder");
const life360Client = require("../../../services/life360Client");

const MAX_CIRCLES = 11;
const MAX_MEMBERS = 10;

function truncateLabel(s, max = 120) {
  const t = String(s || "?").replace(/\n/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function formatMemberName(m) {
  const parts = [m.firstName, m.lastName].filter(Boolean);
  return parts.length ? parts.join(" ") : "Membro";
}

const vinculo360Flow = createFlow("vinculo360", {
  root: {
    title: "Vínculo Life360",
    dynamic: true,
    handler: async (ctx) => {
      let status;
      try {
        status = await life360Client.getStatus();
      } catch (e) {
        return {
          title:
            "❌ Não foi possível falar com o servidor Life360.\n\n" +
            (e.message || String(e)),
          skipPoll: true,
        };
      }

      if (!status.configured) {
        return {
          title:
            "⚠️ Life360 não está configurado no *servidor*.\n\n" +
            "Peça ao administrador para definir `LIFE360_USERNAME` e `LIFE360_PASSWORD`.",
          skipPoll: true,
        };
      }

      if (!status.authenticated) {
        return {
          title:
            "⚠️ Life360: login falhou no servidor.\n\n" +
            (status.last_error
              ? `Último erro: ${String(status.last_error).slice(0, 300)}`
              : "Verifique as credenciais no env do backend."),
          skipPoll: true,
        };
      }

      let circles;
      try {
        circles = await life360Client.getCircles();
      } catch (e) {
        return {
          title: "❌ Erro ao listar círculos: " + (e.message || String(e)),
          skipPoll: true,
        };
      }

      if (!Array.isArray(circles) || circles.length === 0) {
        return {
          title: "Nenhum círculo encontrado na conta Life360.",
          skipPoll: true,
        };
      }

      const truncated = circles.length > MAX_CIRCLES;
      const slice = circles.slice(0, MAX_CIRCLES);
      const title =
        (truncated
          ? `Escolha o círculo (primeiros ${MAX_CIRCLES}):`
          : "Escolha o círculo:") +
        "\n\nDepois escolha *o membro que é você* para vincular à sua conta do bot.";

      const options = slice.map((c) => ({
        label: truncateLabel(`⭕ ${c.name || c.id || "?"}`),
        action: "exec",
        handler: "pickCircle",
        data: {
          circleId: c.id,
          name: c.name || String(c.id),
        },
      }));

      options.push({ label: "🔙 Sair", action: "exec", handler: "leaveVinculo" });

      return { title, options, skipPoll: false };
    },
  },

  "/members": {
    title: "Membros",
    dynamic: true,
    handler: async (ctx) => {
      const circleId = ctx.state.context && ctx.state.context.circleId;
      const circleName =
        (ctx.state.context && ctx.state.context.circleName) || "Círculo";

      if (!circleId) {
        return {
          title: "❌ Círculo não selecionado. Use /vinculo360 de novo.",
          skipPoll: true,
        };
      }

      let members;
      try {
        members = await life360Client.getMembers(circleId);
      } catch (e) {
        return {
          title: "❌ Erro ao carregar membros: " + (e.message || String(e)),
          skipPoll: true,
        };
      }

      if (!Array.isArray(members) || members.length === 0) {
        return {
          title: `Nenhum membro em “${truncateLabel(circleName, 40)}”.`,
          skipPoll: true,
        };
      }

      const truncated = members.length > MAX_MEMBERS;
      const slice = members.slice(0, MAX_MEMBERS);
      const title =
        `Quem é você neste círculo? — ${truncateLabel(circleName, 50)}` +
        (truncated ? ` (primeiros ${MAX_MEMBERS})` : "");

      const options = slice.map((m) => {
        const displayName = formatMemberName(m);
        return {
          label: truncateLabel(`👤 ${displayName}`),
          action: "exec",
          handler: "selectMemberForLink",
          data: {
            displayName,
            memberId: m.id,
          },
        };
      });

      options.push({ label: "🔙 Voltar aos círculos", action: "back" });

      return { title, options, skipPoll: false };
    },
  },

  "/confirm": {
    title: "Confirmar",
    dynamic: true,
    handler: async (ctx) => {
      const pending = ctx.state.context && ctx.state.context.pendingMember;
      if (!pending || !pending.memberId) {
        return {
          title: "❌ Sessão inválida. Use /vinculo360 de novo.",
          skipPoll: true,
        };
      }
      const title =
        `Confirmar vínculo?\n\n` +
        `Membro: *${pending.displayName}*\n` +
        `ID: \`${pending.memberId}\`\n\n` +
        `Isto associa este membro Life360 à *sua* conta do bot.`;
      return {
        title,
        options: [
          { label: "✅ Confirmar vínculo", action: "exec", handler: "confirmLink" },
          { label: "🔙 Voltar", action: "back" },
          { label: "❌ Cancelar", action: "exec", handler: "cancelVinculo" },
        ],
        skipPoll: false,
      };
    },
  },

  handlers: {
    pickCircle: async (ctx, data) => {
      ctx.state.context = ctx.state.context || {};
      ctx.state.context.circleId = data.circleId;
      ctx.state.context.circleName = data.name;
      ctx.state.history.push("/");
      ctx.state.path = "/members";
    },

    selectMemberForLink: async (ctx, data) => {
      ctx.state.context = ctx.state.context || {};
      ctx.state.context.pendingMember = {
        memberId: data.memberId,
        displayName: data.displayName,
      };
      ctx.state.history.push("/members");
      ctx.state.path = "/confirm";
    },

    confirmLink: async (ctx) => {
      const wa =
        (ctx.state.context && ctx.state.context.waIdentifier) || ctx.userId;
      const pending = ctx.state.context && ctx.state.context.pendingMember;
      if (!wa || !pending || !pending.memberId) {
        await ctx.reply("❌ Dados em falta. Use /vinculo360 de novo.");
        return { end: true };
      }
      try {
        await life360Client.linkLife360Member(wa, pending.memberId);
        await ctx.reply(
          `✅ Conta vinculada ao membro Life360 *${pending.displayName}*.\n\n` +
            "Pode usar /life360 no grupo para ver a sua localização (se o círculo estiver configurado no servidor).",
        );
      } catch (e) {
        let msg = e.message || String(e);
        if (e.body && e.body.error) msg = String(e.body.error);
        await ctx.reply("❌ " + msg);
      }
      return { end: true };
    },

    cancelVinculo: async (ctx) => {
      await ctx.reply("Vínculo cancelado.");
      return { end: true };
    },

    leaveVinculo: async (ctx) => {
      await ctx.reply("👋 Fechado.");
      return { end: true };
    },
  },
});

module.exports = vinculo360Flow;
