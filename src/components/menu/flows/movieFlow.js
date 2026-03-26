/**
 * Flow: resumo de filmes por período (GET /api/movies/period-stats + cartão PNG).
 * Só envia imagem se summary.hasActivityInPeriod (como notas Spotify).
 */

const { createFlow } = require("../flowBuilder");
const fetch = require("node-fetch");
const path = require("path");
const { renderMoviesCard } = require("../../../services/statsCardService");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

async function resolveUserUuid(externalId) {
  if (!externalId) return null;
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      externalId,
    );
  if (isUUID) return externalId;

  try {
    const url = `${BACKEND_URL}/api/users/by-identifier/${encodeURIComponent(
      externalId,
    )}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.user && json.user.id ? json.user.id : null;
  } catch (e) {
    return null;
  }
}

const movieFlow = createFlow("movies", {
  root: {
    title: "📊 Resumo de filmes — escolha o período",
    options: [
      {
        label: "Esse mês",
        action: "exec",
        handler: "movieStats",
        data: { period: "month" },
      },
      {
        label: "Últimos 7 dias",
        action: "exec",
        handler: "movieStats",
        data: { days: 7 },
      },
      {
        label: "Últimos 30 dias",
        action: "exec",
        handler: "movieStats",
        data: { days: 30 },
      },
      {
        label: "Últimos 90 dias",
        action: "exec",
        handler: "movieStats",
        data: { days: 90 },
      },
      {
        label: "Selecionar o mês",
        action: "goto",
        target: "/stats/select-month",
      },
      {
        label: "Geral",
        action: "exec",
        handler: "movieStats",
        data: { days: 0 },
      },
      { label: "⬅️ Voltar", action: "back" },
    ],
  },

  "/stats/select-month": {
    title: "📅 Selecione o período",
    dynamic: true,
    handler: async () => {
      const opts = [];
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        let label = d.toLocaleString("pt-BR", {
          month: "long",
          year: "numeric",
        });
        if (label && label.length > 0) {
          label = label.charAt(0).toUpperCase() + label.slice(1);
        }
        opts.push({
          label,
          action: "exec",
          handler: "movieStatsMonth",
          data: { month: value },
        });
      }
      opts.push({ label: "⬅️ Voltar", action: "back" });
      return { options: opts };
    },
  },

  handlers: {
    movieStats: async (ctx, data) => {
      try {
        const resolved = await resolveUserUuid(ctx.userId);
        const userParam = resolved || ctx.userId;
        const period = data && data.period;
        const days =
          data && typeof data.days !== "undefined" && data.days !== null
            ? data.days
            : 7;

        let url = `${BACKEND_URL}/api/movies/period-stats?userId=${encodeURIComponent(
          userParam,
        )}`;

        let displayLabel = null;
        if (period === "month") {
          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          url += `&from=${encodeURIComponent(monthStart.toISOString())}`;
          url += `&to=${encodeURIComponent(new Date().toISOString())}`;
          displayLabel = now.toLocaleString("pt-BR", { month: "long" });
        } else {
          if (days && Number(days) > 0) url += `&days=${Number(days)}`;
          displayLabel =
            days && Number(days) > 0 ? `últimos ${days} dias` : `Geral`;
        }

        if (displayLabel) {
          url += `&period=${encodeURIComponent(displayLabel)}`;
        }

        const res = await fetch(url, { method: "GET" });
        const json = await res.json();

        if (!json || !json.summary) {
          await ctx.reply("❌ Erro ao obter estatísticas de filmes.");
          return { end: false, noRender: true };
        }

        if (!json.summary.hasActivityInPeriod) {
          await ctx.reply("_Nenhuma atividade de filmes neste período._");
          return { end: false, noRender: true };
        }

        const logoPath = path.join(process.cwd(), "templates", "logo.png");
        const templateData = {
          ...json,
          logoPath,
          periodDisplay: displayLabel || json.period,
        };

        const img = await renderMoviesCard(templateData, {
          width: 1080,
          height: 1920,
        });
        const { MessageMedia } = require("whatsapp-web.js");
        const media = new MessageMedia("image/png", img.toString("base64"));
        await ctx.client.sendMessage(ctx.chatId, media, { caption: "" });
      } catch (e) {
        console.error("[movieFlow] movieStats:", e && e.message ? e.message : e);
        await ctx.reply(
          "❌ Erro ao gerar resumo de filmes: " +
            (e && e.message ? e.message : e),
        );
      }
      return { end: false, noRender: true };
    },

    movieStatsMonth: async (ctx, data) => {
      try {
        const month = data?.month;
        if (!month) {
          await ctx.reply("❌ Mês inválido.");
          return { end: false, noRender: true };
        }

        const resolved = await resolveUserUuid(ctx.userId);
        const userParam = resolved || ctx.userId;

        const [year, monthNum] = month.split("-");
        const monthStart = new Date(parseInt(year, 10), parseInt(monthNum, 10) - 1, 1);
        const monthEnd = new Date(parseInt(year, 10), parseInt(monthNum, 10), 1);

        let url = `${BACKEND_URL}/api/movies/period-stats?userId=${encodeURIComponent(
          userParam,
        )}`;
        url += `&from=${encodeURIComponent(monthStart.toISOString())}`;
        url += `&to=${encodeURIComponent(monthEnd.toISOString())}`;

        const date = new Date(monthStart);
        const displayLabel = date.toLocaleString("pt-BR", {
          month: "long",
          year: "numeric",
        });
        url += `&period=${encodeURIComponent(displayLabel)}`;

        const res = await fetch(url, { method: "GET" });
        const json = await res.json();

        if (!json || !json.summary) {
          await ctx.reply("❌ Erro ao obter estatísticas de filmes.");
          return { end: false, noRender: true };
        }

        if (!json.summary.hasActivityInPeriod) {
          await ctx.reply("_Nenhuma atividade de filmes neste período._");
          return { end: false, noRender: true };
        }

        const logoPath = path.join(process.cwd(), "templates", "logo.png");
        const templateData = {
          ...json,
          logoPath,
          periodDisplay: displayLabel,
        };

        const img = await renderMoviesCard(templateData, {
          width: 1080,
          height: 1920,
        });
        const { MessageMedia } = require("whatsapp-web.js");
        const media = new MessageMedia("image/png", img.toString("base64"));
        await ctx.client.sendMessage(ctx.chatId, media, { caption: "" });
      } catch (e) {
        console.error(
          "[movieFlow] movieStatsMonth:",
          e && e.message ? e.message : e,
        );
        await ctx.reply(
          "❌ Erro ao gerar resumo de filmes: " +
            (e && e.message ? e.message : e),
        );
      }
      return { end: false, noRender: true };
    },
  },
});

module.exports = movieFlow;
