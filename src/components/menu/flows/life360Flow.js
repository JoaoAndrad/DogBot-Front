/**
 * Flow /life360 — círculos → membros → detalhe de localização (via backend Life360).
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

function formatLocationMessage(data) {
  const name = data.displayName || "Membro";
  const loc = data.location || {};
  const lines = [`📍 *${name}*`];
  const place =
    loc.shortAddress ||
    loc.name ||
    loc.address1 ||
    (loc.latitude != null && loc.longitude != null
      ? `${loc.latitude}, ${loc.longitude}`
      : null);
  if (place) lines.push(`📌 ${place}`);
  if (loc.latitude != null && loc.longitude != null) {
    lines.push(
      `🗺️ https://maps.google.com/?q=${encodeURIComponent(`${loc.latitude},${loc.longitude}`)}`,
    );
  }
  if (loc.battery != null && loc.battery !== "") {
    lines.push(`🔋 Bateria: ${loc.battery}%`);
  }
  if (loc.isDriving === "1" || loc.isDriving === true) {
    lines.push("🚗 Em deslocação");
  }
  return lines.join("\n");
}

const life360Flow = createFlow("life360", {
  root: {
    title: "Life360",
    dynamic: true,
    handler: async (ctx) => {
      const isGroup = String(ctx.chatId || "").endsWith("@g.us");
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
            "Peça ao administrador para definir `LIFE360_USERNAME` e `LIFE360_PASSWORD` no ambiente do backend.",
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
          title:
            "❌ Erro ao listar círculos: " + (e.message || String(e)),
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
      const titlePrefix = isGroup
        ? "📍 *Life360* (dados sensíveis — prefira usar no privado)\n\n"
        : "";
      const title =
        titlePrefix +
        (truncated
          ? `Escolha um círculo (mostrando os primeiros ${MAX_CIRCLES}):`
          : "Escolha um círculo:");

      const options = slice.map((c) => ({
        label: truncateLabel(`⭕ ${c.name || c.id || "?"}`),
        action: "exec",
        handler: "pickCircle",
        data: {
          circleId: c.id,
          name: c.name || String(c.id),
        },
      }));

      options.push({ label: "🔙 Sair", action: "exec", handler: "leaveLife360" });

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
          title: "❌ Círculo não selecionado. Use /life360 de novo.",
          skipPoll: true,
        };
      }

      let members;
      try {
        members = await life360Client.getMembers(circleId);
      } catch (e) {
        return {
          title:
            "❌ Erro ao carregar membros: " + (e.message || String(e)),
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
        `Membros — ${truncateLabel(circleName, 50)}` +
        (truncated ? ` (primeiros ${MAX_MEMBERS})` : "");

      const options = slice.map((m) => {
        const displayName = formatMemberName(m);
        const loc = m.location || {};
        return {
          label: truncateLabel(`👤 ${displayName}`),
          action: "exec",
          handler: "pickMember",
          data: {
            displayName,
            memberId: m.id,
            location: {
              latitude: loc.latitude,
              longitude: loc.longitude,
              name: loc.name,
              shortAddress: loc.shortAddress,
              address1: loc.address1,
              battery: loc.battery,
              isDriving: loc.isDriving,
              inTransit: loc.inTransit,
            },
          },
        };
      });

      options.push({ label: "🔙 Voltar aos círculos", action: "back" });

      return { title, options, skipPoll: false };
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

    pickMember: async (ctx, data) => {
      const text = formatLocationMessage(data);
      await ctx.reply(text);
      return { end: true };
    },

    leaveLife360: async (ctx) => {
      await ctx.reply("👋 Life360 fechado.");
      return { end: true };
    },
  },
});

module.exports = life360Flow;
