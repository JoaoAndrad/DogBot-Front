"use strict";

const { createFlow } = require("../flowBuilder");
const worldcupClient = require("../../../services/worldcupClient");
const conversationState = require("../../../services/conversationState");
const logger = require("../../../utils/logger");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMatchLine(m) {
  const kickoff = new Date(m.kickoff_at);
  const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  if (m.status === "live") {
    return `🔴 ${m.home_team} ${m.home_score ?? 0}x${m.away_score ?? 0} ${m.away_team} — AO VIVO`;
  }
  if (m.status === "finished") {
    return `✅ ${m.home_team} ${m.home_score}x${m.away_score} ${m.away_team}`;
  }
  return `📅 ${date} ${time} — ${m.home_team} 🆚 ${m.away_team}`;
}

function formatStandingsBlock(standings) {
  const lines = ["```", "Pos  Time          Pts  PJ  SG"];
  for (const s of standings) {
    const pos = String(s.position).padEnd(3);
    const team = (s.team || "").slice(0, 12).padEnd(13);
    const pts = String(s.points).padEnd(4);
    const played = String(s.played).padEnd(3);
    const gd = s.gd >= 0 ? `+${s.gd}` : String(s.gd);
    lines.push(`${pos}  ${team}  ${pts} ${played} ${gd}`);
  }
  lines.push("```");
  return lines.join("\n");
}

// ─── Flow ─────────────────────────────────────────────────────────────────────

const worldcupFlow = createFlow("copa", {
  root: {
    title: "⚽ *Copa do Mundo*",
    options: [
      { label: "📅 Próximos jogos", action: "exec", handler: "showNextMatches" },
      { label: "📊 Tabela", action: "goto", target: "/tabela" },
      { label: "🏆 Ranking do grupo", action: "exec", handler: "showLeaderboard" },
      { label: "📋 Meus palpites", action: "exec", handler: "showMyPredictions" },
      { label: "⚙️ Configurações", action: "exec", handler: "showSettings" },
      { label: "👋 Sair", action: "exec", handler: "leave" },
    ],
  },

  "/tabela": {
    title: "📊 *Tabela — Escolha o grupo*",
    options: [
      { label: "Grupo A", action: "exec", handler: "showGroup", data: { group: "A" } },
      { label: "Grupo B", action: "exec", handler: "showGroup", data: { group: "B" } },
      { label: "Grupo C", action: "exec", handler: "showGroup", data: { group: "C" } },
      { label: "Grupo D", action: "exec", handler: "showGroup", data: { group: "D" } },
      { label: "Grupo E", action: "exec", handler: "showGroup", data: { group: "E" } },
      { label: "Grupo F", action: "exec", handler: "showGroup", data: { group: "F" } },
      { label: "Grupo G", action: "exec", handler: "showGroup", data: { group: "G" } },
      { label: "Grupo H", action: "exec", handler: "showGroup", data: { group: "H" } },
      { label: "🔙 Voltar", action: "back" },
    ],
  },

  handlers: {
    showNextMatches: async (ctx) => {
      try {
        const { match } = await worldcupClient.getNextMatch();
        if (!match) {
          await ctx.reply("⚽ Nenhum jogo agendado.");
          return { noRender: true };
        }
        await ctx.reply(formatMatchLine(match));
      } catch (e) {
        logger.error("[worldcupFlow] showNextMatches:", e.message);
        await ctx.reply("❌ Erro ao buscar jogo.");
      }
      return { noRender: true };
    },

    showGroup: async (ctx, data) => {
      try {
        const { standings } = await worldcupClient.getStandings(`Group ${data.group}`);
        if (!standings || !standings.length) {
          await ctx.reply(`⚽ Dados do Grupo ${data.group} ainda não disponíveis.`);
          return { noRender: true };
        }
        await ctx.reply(`📊 *Grupo ${data.group}*\n${formatStandingsBlock(standings)}`);
      } catch (e) {
        logger.error("[worldcupFlow] showGroup:", e.message);
        await ctx.reply("❌ Erro ao buscar tabela.");
      }
      return { noRender: true };
    },

    showLeaderboard: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      if (!isGroup) {
        await ctx.reply("⚽ O ranking só está disponível em grupos.");
        return { noRender: true };
      }
      try {
        const chat = await ctx.message.getChat();
        const participants = chat.participants || [];
        const userIds = participants.map((p) => p.id._serialized || p.id.user + "@c.us");
        const { leaderboard } = await worldcupClient.getLeaderboard(ctx.chatId, userIds);

        if (!leaderboard || !leaderboard.length) {
          await ctx.reply("⚽ Nenhum palpite pontuado ainda. Use */palpite* (no privado) para participar!");
          return { noRender: true };
        }

        const medals = ["🥇", "🥈", "🥉"];
        const lines = ["🏆 *Ranking — Copa do Mundo*", ""];
        for (let i = 0; i < leaderboard.length; i++) {
          const e = leaderboard[i];
          const p = participants.find((x) => (x.id._serialized || x.id.user + "@c.us") === e.userId);
          const name = p ? (p.pushname || p.name || e.userId.split("@")[0]) : e.userId.split("@")[0];
          lines.push(`${medals[i] || `${i + 1}.`} ${name} — *${e.totalPoints} pts*`);
        }
        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[worldcupFlow] showLeaderboard:", e.message);
        await ctx.reply("❌ Erro ao buscar ranking.");
      }
      return { noRender: true };
    },

    showMyPredictions: async (ctx) => {
      const isPrivate = !String(ctx.chatId).endsWith("@g.us");
      if (!isPrivate) {
        await ctx.reply("📋 Envie */palpite* no privado para ver e fazer seus palpites.");
        return { noRender: true };
      }
      try {
        const { predictions } = await worldcupClient.getUserPredictions(ctx.userId);
        if (!predictions || !predictions.length) {
          await ctx.reply("⚽ Você ainda não fez nenhum palpite.");
          return { noRender: true };
        }
        const lines = ["📋 *Seus palpites*", ""];
        for (const p of predictions) {
          const m = p.match;
          const score = `${p.predicted_home} x ${p.predicted_away}`;
          const pts = p.points != null ? ` — ${p.points} pts` : " — aguardando";
          lines.push(`${m.home_team} 🆚 ${m.away_team}: *${score}*${pts}`);
        }
        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[worldcupFlow] showMyPredictions:", e.message);
        await ctx.reply("❌ Erro ao buscar palpites.");
      }
      return { noRender: true };
    },

    showSettings: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      if (!isGroup) {
        await ctx.reply("⚙️ As configurações só estão disponíveis em grupos.");
        return { noRender: true };
      }
      try {
        const settings = await worldcupClient.getGroupSettings(ctx.chatId);
        const lines = [
          "⚙️ *Configurações Copa — este grupo*",
          "",
          `🔔 Notificações de gol: ${settings.goal_notifications ? "✅" : "❌"}`,
          `⏰ Lembretes de jogo: ${settings.match_reminders ? "✅" : "❌"}`,
          `📊 Resumo semanal: ${settings.weekly_summary ? "✅" : "❌"}`,
          `🎯 Bolão: ${settings.prediction_enabled ? "✅" : "❌"}`,
          "",
          "Para alterar as configurações, peça ao admin do grupo.",
        ];
        await ctx.reply(lines.join("\n"));
      } catch (e) {
        await ctx.reply("❌ Erro ao buscar configurações.");
      }
      return { noRender: true };
    },

    leave: async (ctx) => {
      await ctx.reply("⚽ Até a próxima!");
      return { end: true };
    },
  },
});

// ─── Prediction flow (private chat) ──────────────────────────────────────────

const worldcupPalpiteFlow = createFlow("copa-palpite", {
  root: {
    title: "🎯 *Palpites — Copa do Mundo*",
    dynamic: true,
    handler: async (ctx) => {
      try {
        const { match } = await worldcupClient.getNextMatch();
        if (!match) {
          return {
            title: "⚽ Nenhum jogo disponível para palpite no momento.",
            skipPoll: true,
          };
        }
        const kickoff = new Date(match.kickoff_at);
        const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
        const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
        return {
          title: `🎯 *Palpite — ${match.home_team} 🆚 ${match.away_team}*\n📅 ${date} às ${time}\n\nQual o seu palpite?`,
          options: [
            { label: "Vitória do time da casa", action: "exec", handler: "startPrediction", data: { matchId: match.id, homeTeam: match.home_team, awayTeam: match.away_team } },
            { label: "Empate", action: "exec", handler: "startPredictionDraw", data: { matchId: match.id, homeTeam: match.home_team, awayTeam: match.away_team } },
            { label: "Vitória visitante", action: "exec", handler: "startPredictionAway", data: { matchId: match.id, homeTeam: match.home_team, awayTeam: match.away_team } },
            { label: "👋 Sair", action: "exec", handler: "leave" },
          ],
        };
      } catch (e) {
        return { title: "❌ Erro ao carregar jogo.", skipPoll: true };
      }
    },
  },

  handlers: {
    startPrediction: async (ctx, data) => {
      conversationState.startFlow(ctx.userId, "copa-palpite-input", {
        step: "await_home_score",
        matchId: data.matchId,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
      });
      await ctx.reply(`⚽ Quantos gols marca *${data.homeTeam}*? (só o número)`);
      return { end: true };
    },

    startPredictionDraw: async (ctx, data) => {
      conversationState.startFlow(ctx.userId, "copa-palpite-input", {
        step: "await_home_score_draw",
        matchId: data.matchId,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
      });
      await ctx.reply(`⚽ Placar do empate? Quantos gols cada time?\nDigite os gols de *${data.homeTeam}* (só o número)`);
      return { end: true };
    },

    startPredictionAway: async (ctx, data) => {
      conversationState.startFlow(ctx.userId, "copa-palpite-input", {
        step: "await_home_score_away",
        matchId: data.matchId,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
      });
      await ctx.reply(`⚽ Quantos gols marca *${data.homeTeam}*? (só o número)`);
      return { end: true };
    },

    leave: async (ctx) => {
      await ctx.reply("⚽ Até a próxima!");
      return { end: true };
    },
  },
});

module.exports = { worldcupFlow, worldcupPalpiteFlow };
