"use strict";

const { createFlow } = require("../flowBuilder");
const worldcupClient = require("../../../services/worldcupClient");
const conversationState = require("../../../services/conversationState");
const polls = require("../../poll");
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
        const { matches } = await worldcupClient.getNextMatches(5);
        if (!matches || !matches.length) {
          await ctx.reply("⚽ Nenhum jogo agendado.");
          return { noRender: true };
        }
        const lines = ["⚽ *Próximos jogos*", ""];
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          const kickoff = new Date(m.kickoff_at);
          const weekday = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short" });
          const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
          const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
          const stage = m.group_name ? `Grupo ${m.group_name.replace("GROUP_", "").replace("Group ", "")}` : m.stage;
          if (i > 0) lines.push("");
          lines.push(`*${i + 1}.* ${m.home_team} 🆚 ${m.away_team}`);
          lines.push(`📅 ${weekday} ${date} ${time} · ${stage}`);
          if (m.venue) lines.push(`🏟 ${m.venue}`);
        }
        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[worldcupFlow] showNextMatches:", e.message);
        await ctx.reply("❌ Erro ao buscar jogos.");
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

const PAGE_SIZE = 10;

async function showMatchPage(ctx, data) {
  const page = (data && data.page) || 0;
  const offset = page * PAGE_SIZE;

  let result;
  try {
    result = await worldcupClient.getNextMatches(PAGE_SIZE, offset);
  } catch (e) {
    logger.error("[copa-palpite] getNextMatches:", e.message);
    await ctx.reply("❌ Erro ao carregar jogos.");
    return { end: true };
  }

  const { matches, hasMore } = result;

  if (!matches || !matches.length) {
    await ctx.reply("⚽ Nenhum jogo disponível para palpite no momento.");
    return { end: true };
  }

  let predByMatchId = {};
  try {
    const { predictions } = await worldcupClient.getUserPredictions(ctx.userId);
    for (const p of predictions || []) predByMatchId[p.match_id] = p;
  } catch (e) { /* optional */ }

  const optionLabels = [];
  const optionsMeta = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const kickoff = new Date(m.kickoff_at);
    const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
    const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    const pred = predByMatchId[m.id];
    const predTag = pred ? ` ✏️ ${pred.predicted_home}-${pred.predicted_away}` : "";
    const label = `${m.home_team} x ${m.away_team} · ${date} ${time}${predTag}`.slice(0, 100);

    optionLabels.push(label);
    optionsMeta.push({
      index: i,
      label,
      action: "exec",
      handler: "showMatchPage",
      data: {
        matchId: m.id,
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        kickoffAt: m.kickoff_at,
        venue: m.venue || null,
      },
    });
    // Override: selecting a match should go to selectMatch, not showMatchPage
    optionsMeta[i].handler = "selectMatch";
  }

  if (hasMore) {
    const nextLabel = `➡️ Ver mais jogos (pág. ${page + 2})`;
    optionLabels.push(nextLabel);
    optionsMeta.push({
      index: optionLabels.length - 1,
      label: nextLabel,
      action: "exec",
      handler: "showMatchPage",
      data: { page: page + 1 },
    });
  }

  optionLabels.push("❌ Sair");
  optionsMeta.push({
    index: optionLabels.length - 1,
    label: "❌ Sair",
    action: "exec",
    handler: "leave",
    data: {},
  });

  const pageLabel = page > 0 ? ` — pág. ${page + 1}` : "";
  await polls.createPoll(
    ctx.client,
    ctx.chatId,
    `🎯 Palpites — Copa 2026${pageLabel}`,
    optionLabels,
    {
      metadata: {
        actionType: "menu",
        flowId: "copa-palpite",
        path: "/",
        userId: ctx.userId,
        options: optionsMeta,
      },
    },
  );

  return { end: true };
}

const worldcupPalpiteFlow = createFlow("copa-palpite", {
  root: {
    title: "🎯 *Palpites — Copa do Mundo*",
    dynamic: true,
    handler: async (ctx) => {
      // Delegate to showMatchPage — root kicks off page 0
      await showMatchPage(ctx, { page: 0 });
      return { skipPoll: true };
    },
  },

  handlers: {
    showMatchPage: async (ctx, data) => showMatchPage(ctx, data),

    selectMatch: async (ctx, data) => {
      const { matchId, homeTeam, awayTeam, kickoffAt, venue } = data;

      conversationState.startFlow(ctx.userId, "copa-palpite-input", {
        step: "await_score",
        matchId,
        homeTeam,
        awayTeam,
        kickoffAt,
        venue,
        userId: ctx.userId,
      });

      const kickoff = new Date(kickoffAt);
      const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
      const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

      const lines = [
        `🎯 *${homeTeam} x ${awayTeam}*`,
        `📅 ${date} às ${time}`,
      ];
      if (venue) lines.push(`🏟 ${venue}`);
      lines.push("", "Qual o placar? Digite no formato *H-A*");
      lines.push(`Ex: *2-1* significa ${homeTeam} 2, ${awayTeam} 1`);
      lines.push("_(ou /cancelar para voltar)_");

      await ctx.reply(lines.join("\n"));
      return { end: true };
    },

    leave: async (ctx) => {
      await ctx.reply("⚽ Até a próxima!");
      return { end: true };
    },
  },
});

module.exports = { worldcupFlow, worldcupPalpiteFlow };
