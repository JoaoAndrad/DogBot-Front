"use strict";

const { createFlow } = require("../flowBuilder");
const cartolaClient = require("../../../services/cartolaClient");
const conversationState = require("../../../services/conversationState");
const polls = require("../../poll");
const logger = require("../../../utils/logger");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPontuacao(pontos) {
  if (pontos == null) return "–";
  return Number(pontos).toFixed(2).replace(".", ",");
}

function formatMercadoStatus(rodada) {
  if (!rodada) return "❓ Mercado indisponível";
  const status = rodada.mercadoAberto ? "🟢 Mercado *aberto*" : "🔴 Mercado *fechado*";
  const rodadaNum = rodada.rodada ? `Rodada *${rodada.rodada}*` : "";
  return [rodadaNum, status].filter(Boolean).join(" — ");
}

// ─── Polling pós-auth ────────────────────────────────────────────────────────

function _pollGloboAuth(userId, reply) {
  const INTERVAL = 5000;
  const TIMEOUT  = 10 * 60 * 1000;
  const started  = Date.now();

  const timer = setInterval(async () => {
    try {
      if (Date.now() - started > TIMEOUT) {
        clearInterval(timer);
        return;
      }

      const { connected } = await cartolaClient.getAuthStatus(userId);
      if (!connected) return;

      clearInterval(timer);

      // Busca dados autenticados do time e ligas
      const lines = ["✅ *Conta Globo conectada com sucesso!*", ""];

      try {
        const timeData = await cartolaClient.getAuthTimeData(userId);
        const time = timeData?.data?.time || timeData?.data;
        if (time?.nome) {
          lines.push(`🏠 *Time:* ${time.nome}`);
          if (time.nome_cartola) lines.push(`👤 ${time.nome_cartola}`);
          if (timeData?.data?.pontos != null) {
            lines.push(`📊 Pontuação: *${Number(timeData.data.pontos).toFixed(2).replace(".", ",")} pts*`);
          }
          lines.push("");
        }
      } catch (e) {
        logger.warn("[cartolaFlow] poll getAuthTimeData:", e.message);
      }

      try {
        const ligasData = await cartolaClient.getAuthLigas(userId);
        const ligas = ligasData?.data?.ligas || ligasData?.data || [];
        if (Array.isArray(ligas) && ligas.length) {
          lines.push("🏆 *Suas ligas:*");
          for (const l of ligas.slice(0, 5)) {
            lines.push(`• ${l.nome || l.name || l.slug}`);
          }
        }
      } catch (e) {
        logger.warn("[cartolaFlow] poll getAuthLigas:", e.message);
      }

      await reply(lines.join("\n"));
    } catch (e) {
      logger.warn("[cartolaFlow] pollGloboAuth:", e.message);
    }
  }, INTERVAL);
}

// ─── Flow principal ───────────────────────────────────────────────────────────

const cartolaFlow = createFlow("cartola", {
  root: {
    title: "⚽ *Cartola FC*",
    options: [
      { label: "🏠 Meu time",           action: "exec", handler: "showMyTeam" },
      { label: "🏆 Ranking da liga",     action: "exec", handler: "showLeagueRanking" },
      { label: "📊 Rodada atual",        action: "exec", handler: "showRodada" },
      { label: "⚙️ Configurações",       action: "goto", target: "/config" },
      { label: "👋 Sair",               action: "exec", handler: "leave" },
    ],
  },

  "/config": {
    title: "⚙️ *Configurações — Cartola FC*",
    dynamic: true,
    handler: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      const options = [
        ...(isGroup ? [{ label: "🏆 Vincular liga (grupo)", action: "exec", handler: "startLeagueLink" }] : []),
        { label: "🔓 Conectar conta Globo", action: "exec", handler: "startGloboAuth" },
        { label: "🔌 Desconectar conta",    action: "exec", handler: "disconnectGlobo" },
        { label: "🔙 Voltar",              action: "back" },
      ];
      return { title: "⚙️ *Configurações — Cartola FC*", options };
    },
  },

  handlers: {
    // ── Meu time ─────────────────────────────────────────────────────────────
    showMyTeam: async (ctx) => {
      let saved;
      try {
        const { team } = await cartolaClient.getUserTeam(ctx.userId);
        saved = team;
      } catch (e) {
        logger.error("[cartolaFlow] getUserTeam:", e.message);
        await ctx.reply("❌ Erro ao buscar seu time. Tente novamente.");
        return { noRender: true };
      }

      if (!saved) {
        await ctx.reply(
          "⚽ *Meu time*\n\nVocê ainda não vinculou seu time do Cartola FC.\n\n" +
          "Use ⚙️ *Configurações → Vincular meu time* para começar.",
        );
        return { noRender: true };
      }

      // Tenta buscar dados ao vivo
      try {
        const { data } = await cartolaClient.getMyTeamData(ctx.userId);
        const time = data?.time || data;
        const atletas = data?.atletas || [];

        const lines = [
          `🏠 *${time?.nome || saved.team_name || saved.slug}*`,
          `👤 ${time?.nome_cartola || "–"}`,
          "",
        ];

        if (atletas.length) {
          lines.push("*Escalação:*");
          for (const a of atletas.slice(0, 11)) {
            const pts = a.pontuacao != null ? ` — *${formatPontuacao(a.pontuacao)} pts*` : "";
            lines.push(`• ${a.apelido || a.nome}${pts}`);
          }
        } else {
          lines.push("_Escalação não disponível (mercado fechado ou rodada não iniciada)_");
        }

        const pontosTotais = data?.pontos || data?.pontuacao;
        if (pontosTotais != null) {
          lines.push("", `📊 Total: *${formatPontuacao(pontosTotais)} pts*`);
        }

        await ctx.reply(lines.join("\n"));
      } catch (e) {
        if (e.message === "team_not_found") {
          await ctx.reply(`⚽ *${saved.team_name || saved.slug}*\n\nSlug salvo mas time não encontrado na API. Use ⚙️ Configurações para re-vincular.`);
        } else {
          await ctx.reply(`⚽ *${saved.team_name || saved.slug}*\n\n_Dados ao vivo indisponíveis no momento._`);
          logger.error("[cartolaFlow] getMyTeamData:", e.message);
        }
      }

      return { noRender: true };
    },

    // ── Ranking da liga ───────────────────────────────────────────────────────
    showLeagueRanking: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");

      let groupId = ctx.chatId;
      if (!isGroup) {
        await ctx.reply("🏆 O ranking da liga só está disponível em grupos.\n\nUse */cartola* no grupo que tem a liga vinculada.");
        return { noRender: true };
      }

      try {
        const { slug, liga } = await cartolaClient.getLeagueRanking(groupId);
        const times = liga?.times || liga?.ranking || liga?.ligas_times || [];

        if (!times.length) {
          await ctx.reply(`🏆 Liga *${slug}* vinculada, mas sem dados de ranking disponíveis no momento.`);
          return { noRender: true };
        }

        const medals = ["🥇", "🥈", "🥉"];
        const lines = [`🏆 *Ranking — ${liga?.nome || slug}*`, ""];

        for (let i = 0; i < Math.min(times.length, 10); i++) {
          const t = times[i];
          const nome = t.nome || t.time?.nome || `Time ${i + 1}`;
          const pts = t.pontos != null ? ` — *${formatPontuacao(t.pontos)} pts*` : "";
          lines.push(`${medals[i] || `${i + 1}.`} ${nome}${pts}`);
        }

        await ctx.reply(lines.join("\n"));
      } catch (e) {
        if (e.message === "no_league_linked") {
          await ctx.reply("🏆 Nenhuma liga vinculada a este grupo.\n\nUse ⚙️ *Configurações → Vincular liga* para adicionar.");
        } else {
          logger.error("[cartolaFlow] getLeagueRanking:", e.message);
          await ctx.reply("❌ Erro ao buscar ranking da liga. Tente novamente.");
        }
      }

      return { noRender: true };
    },

    // ── Rodada atual ──────────────────────────────────────────────────────────
    showRodada: async (ctx) => {
      try {
        const rodada = await cartolaClient.getRodada();
        const lines = [
          "📊 *Rodada atual — Cartola FC*",
          "",
          formatMercadoStatus(rodada),
        ];

        if (rodada.fechamentoMercado) {
          let dtInput = rodada.fechamentoMercado;
          // "2024-11-01 12:00:00" → "2024-11-01T12:00:00" para o construtor Date()
          if (typeof dtInput === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(dtInput)) {
            dtInput = dtInput.replace(" ", "T");
          }
          const dt = new Date(typeof dtInput === "number" ? dtInput : dtInput);
          if (!isNaN(dt.getTime())) {
            const dateFmt = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
            const timeFmt = dt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
            lines.push(`⏰ Fechamento: ${dateFmt} às ${timeFmt}`);
          }
        }

        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[cartolaFlow] showRodada:", e.message);
        await ctx.reply("❌ Erro ao buscar dados da rodada.");
      }
      return { noRender: true };
    },

    // ── Config: vincular time ─────────────────────────────────────────────────
    startTeamLink: async (ctx) => {
      conversationState.startFlow(ctx.userId, "cartola-team-input", {
        step: "await_slug",
        userId: ctx.userId,
      });
      await ctx.reply(
        "🔗 *Vincular meu time*\n\n" +
        "Me manda o número ou slug do seu time.\n\n" +
        "Você encontra na URL do Cartola FC:\n" +
        "_cartola.globo.com/#!/time/*123456*_ → manda o número\n" +
        "_cartola.globo.com/time/*meu-time*_ → manda o slug\n\n" +
        "_(ou /cancelar para sair)_",
      );
      return { end: true };
    },

    // ── Config: vincular liga ─────────────────────────────────────────────────
    startLeagueLink: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      if (!isGroup) {
        await ctx.reply("🏆 A vinculação de liga só pode ser feita dentro do grupo.");
        return { noRender: true };
      }
      conversationState.startFlow(ctx.userId, "cartola-league-input", {
        step: "await_slug",
        userId: ctx.userId,
        groupId: ctx.chatId,
      });
      await ctx.reply(
        "🏆 *Vincular liga ao grupo*\n\n" +
        "Me manda o slug da liga. Você encontra na URL do Cartola FC:\n" +
        "_cartola.globo.com/ligas/*slug-da-liga*_\n\n" +
        "_(ou /cancelar para sair)_",
      );
      return { end: true };
    },

    // ── Config: conectar Globo ────────────────────────────────────────────────
    startGloboAuth: async (ctx) => {
      if (String(ctx.chatId).endsWith("@g.us")) {
        await ctx.reply("🔒 Alterações de conta são feitas apenas no privado.\n\nEnvie */cartola* aqui no meu privado.");
        return { noRender: true };
      }
      try {
        const { link } = await cartolaClient.getAuthLink(ctx.userId);
        await ctx.reply(
          "🔓 *Conectar conta Globo*\n\n" +
          "Acesse o link abaixo e faça login com sua conta Globo.\n" +
          "O link expira em *10 minutos*.\n\n" +
          `🔗 ${link}`,
        );
        _pollGloboAuth(ctx.userId, ctx.reply);
      } catch (e) {
        logger.error("[cartolaFlow] getAuthLink:", e.message);
        await ctx.reply("❌ Erro ao gerar link de login. Tente novamente.");
      }
      return { end: true };
    },

    // ── Config: desconectar ───────────────────────────────────────────────────
    disconnectGlobo: async (ctx) => {
      if (String(ctx.chatId).endsWith("@g.us")) {
        await ctx.reply("🔒 Alterações de conta são feitas apenas no privado.\n\nEnvie */cartola* aqui no meu privado.");
        return { noRender: true };
      }
      try {
        const { connected } = await cartolaClient.getAuthStatus(ctx.userId);
        if (!connected) {
          await ctx.reply("🔌 Sua conta Globo não está conectada.");
          return { noRender: true };
        }
        await cartolaClient.disconnectAuth(ctx.userId);
        await ctx.reply("✅ Conta Globo desconectada.");
      } catch (e) {
        logger.error("[cartolaFlow] disconnectGlobo:", e.message);
        await ctx.reply("❌ Erro ao desconectar. Tente novamente.");
      }
      return { noRender: true };
    },

    leave: async (ctx) => {
      await ctx.reply("⚽ Até a próxima!");
      return { end: true };
    },
  },
});

module.exports = { cartolaFlow };
