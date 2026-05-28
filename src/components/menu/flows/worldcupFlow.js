"use strict";

const { createFlow } = require("../flowBuilder");
const worldcupClient = require("../../../services/worldcupClient");
const conversationState = require("../../../services/conversationState");
const polls = require("../../poll");
const { withFlag, matchup } = require("../../../utils/teamLocale");
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
      { label: "Grupo I", action: "exec", handler: "showGroup", data: { group: "I" } },
      { label: "Grupo J", action: "exec", handler: "showGroup", data: { group: "J" } },
      { label: "Grupo K", action: "exec", handler: "showGroup", data: { group: "K" } },
      { label: "Grupo L", action: "exec", handler: "showGroup", data: { group: "L" } },
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
          lines.push(`*${i + 1}.* ${matchup(m.home_team, m.away_team)}`);
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
        const { renderStandingsCard } = require("../../../services/worldcupCardService");
        const { sendBufferAsSticker } = require("../../../utils/media/stickerHelper");
        const { groups } = await worldcupClient.getStandingsGrouped(data.group);
        if (!groups || !groups.length) {
          await ctx.reply(`⚽ Dados do Grupo ${data.group} ainda não disponíveis.`);
          return { noRender: true };
        }
        const buffer = await renderStandingsCard(groups);
        await sendBufferAsSticker(ctx.client, ctx.chatId, buffer, { fullOnly: true });
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
          lines.push(`${matchup(m.home_team, m.away_team)}: *${score}*${pts}`);
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
    const label = `${matchup(m.home_team, m.away_team)} · ${date} ${time}${predTag}`.slice(0, 100);

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

// ─── Helpers para "Meus palpites" ────────────────────────────────────────────

function predictionIcon(prediction) {
  const status = prediction.match && prediction.match.status;
  if (status === "scheduled") return "✏️";
  if (status === "live") return "🔴";
  if (status === "paused") return "⏸";
  // finished
  if (prediction.points === 3) return "🏆";
  if (prediction.points === 1) return "✅";
  if (prediction.points === 0) return "❌";
  return "⏳"; // pending scoring
}

function predictionLabel(p) {
  const m = p.match;
  const icon = predictionIcon(p);
  const myScore = `${p.predicted_home}x${p.predicted_away}`;
  const kickoff = new Date(m.kickoff_at);
  const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  if (m.status === "finished" || m.status === "live" || m.status === "paused") {
    const realScore = m.home_score != null ? `${m.home_score}x${m.away_score}` : "?x?";
    return `${icon} ${withFlag(m.home_team)} ${m.home_team} x ${withFlag(m.away_team)} ${m.away_team} · ${realScore} — meu: ${myScore}`.slice(0, 100);
  }
  return `${icon} ${withFlag(m.home_team)} ${m.home_team} x ${withFlag(m.away_team)} ${m.away_team} · ${date} ${time} — ${myScore}`.slice(0, 100);
}

// ─── Prediction flow ──────────────────────────────────────────────────────────

const worldcupPalpiteFlow = createFlow("copa-palpite", {
  root: {
    title: "🎯 *Palpites — Copa do Mundo*",
    options: [
      { label: "📋 Meus palpites", action: "exec", handler: "showMyPredictions" },
      { label: "🎯 Novo palpite",   action: "exec", handler: "showNewPalpite" },
      { label: "❌ Sair",           action: "exec", handler: "leave" },
    ],
  },

  handlers: {
    // ── Meus palpites ───────────────────────────────────────────────────────
    showMyPredictions: async (ctx) => {
      let predictions;
      try {
        ({ predictions } = await worldcupClient.getUserPredictions(ctx.userId));
      } catch (e) {
        await ctx.reply("❌ Erro ao buscar palpites.");
        return { end: true };
      }

      if (!predictions || !predictions.length) {
        await ctx.reply("⚽ Você ainda não fez nenhum palpite.\nUse *Novo palpite* para começar!");
        return { end: true };
      }

      const optionLabels = [];
      const optionsMeta = [];

      for (let i = 0; i < predictions.length; i++) {
        const p = predictions[i];
        const m = p.match;
        const label = predictionLabel(p);
        optionLabels.push(label);

        const isEditable = m.status === "scheduled";
        optionsMeta.push({
          index: i,
          label,
          action: "exec",
          handler: isEditable ? "selectMatch" : "showPredictionDetail",
          data: isEditable
            ? { matchId: m.id, homeTeam: m.home_team, awayTeam: m.away_team, kickoffAt: m.kickoff_at, venue: m.venue }
            : { homeTeam: m.home_team, awayTeam: m.away_team, finalHome: m.home_score, finalAway: m.away_score, predictedHome: p.predicted_home, predictedAway: p.predicted_away, points: p.points, status: m.status },
        });
      }

      optionLabels.push("🔙 Voltar");
      optionsMeta.push({ index: optionLabels.length - 1, label: "🔙 Voltar", action: "exec", handler: "backToRoot", data: {} });

      await polls.createPoll(ctx.client, ctx.chatId, "📋 Meus palpites", optionLabels, {
        metadata: { actionType: "menu", flowId: "copa-palpite", path: "/my", userId: ctx.userId, options: optionsMeta },
      });
      return { end: true };
    },

    showPredictionDetail: async (ctx, data) => {
      const { homeTeam, awayTeam, finalHome, finalAway, predictedHome, predictedAway, points, status } = data;
      const realScore = finalHome != null ? `${finalHome} x ${finalAway}` : "a definir";
      const myScore = `${predictedHome} x ${predictedAway}`;

      const ptLabel = points === 3 ? "🏆 Placar exato — 3 pts"
        : points === 1 ? "✅ Vencedor certo — 1 pt"
        : points === 0 ? "❌ Sem pontos"
        : status === "live" ? "🔴 Jogo em andamento"
        : status === "paused" ? "⏸ Intervalo"
        : "⏳ Aguardando pontuação";

      const lines = [
        `${matchup(homeTeam, awayTeam)}`,
        `Placar final: *${realScore}*`,
        `Meu palpite: *${myScore}*`,
        ptLabel,
      ];
      await ctx.reply(lines.join("\n"));
      return { end: true };
    },

    backToRoot: async (ctx) => {
      const flowManager = require("../flowManager");
      await flowManager.startFlow(ctx.client, ctx.chatId, ctx.userId, "copa-palpite");
      return { end: true };
    },

    // ── Novo palpite ────────────────────────────────────────────────────────
    showNewPalpite: async (ctx) => showMatchPage(ctx, { page: 0 }),
    showMatchPage:  async (ctx, data) => showMatchPage(ctx, data),

    confirmPrediction: async (ctx, data) => {
      const { _submitPrediction } = require("../../../handlers/copaFlowHandler");
      await _submitPrediction(
        data.userId || ctx.userId,
        { ...data, step: "await_confirmation" },
        (msg) => ctx.reply(msg),
      );
      conversationState.clearState(data.userId || ctx.userId);
      return { end: true };
    },

    correctPrediction: async (ctx, data) => {
      const userId = data.userId || ctx.userId;
      conversationState.startFlow(userId, "copa-palpite-input", {
        step: "await_score",
        matchId: data.matchId,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
        kickoffAt: data.kickoffAt,
        venue: data.venue,
        userId,
      });
      const kickoff = new Date(data.kickoffAt);
      const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
      const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      await ctx.reply(
        `✏️ *${matchup(data.homeTeam, data.awayTeam)}*\n📅 ${date} às ${time}\n\n` +
        "Qual o novo placar? (*H-A*)\n_(ou /cancelar para sair)_",
      );
      return { end: true };
    },

    cancelPrediction: async (ctx, data) => {
      conversationState.clearState(data.userId || ctx.userId);
      await ctx.reply("❌ Palpite cancelado.");
      return { end: true };
    },

    selectMatch: async (ctx, data) => {
      const { matchId, homeTeam, awayTeam, kickoffAt, venue } = data;

      conversationState.startFlow(ctx.userId, "copa-palpite-input", {
        step: "await_score",
        matchId, homeTeam, awayTeam, kickoffAt, venue,
        userId: ctx.userId,
      });

      const kickoff = new Date(kickoffAt);
      const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
      const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

      const lines = [
        `🎯 *${matchup(homeTeam, awayTeam)}*`,
        `📅 ${date} às ${time}`,
      ];
      if (venue) lines.push(`🏟 ${venue}`);
      lines.push("", "Qual o placar? Digite no formato *H-A*");
      lines.push(`Ex: *2-1* significa ${homeTeam} 2, ${awayTeam} 1`);
      lines.push("_(ou /cancelar para cancelar o palpite)_");

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
