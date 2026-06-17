"use strict";

const worldcupClient = require("../../services/worldcupClient");
const flowManager = require("../../components/menu/flowManager");
const conversationState = require("../../services/conversationState");
const polls = require("../../components/poll");
const { withFlag, matchup, localize } = require("../../utils/teamLocale");
const logger = require("../../utils/logger");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INLINE_RE = /^(.+?)\s+(\d{1,2})\s*(?:[-xX×]|[aA])\s*(\d{1,2})\s+(.+)$/;

function normStr(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function scoreTeam(query, teamName) {
  const q = normStr(query);
  const en = normStr(teamName);
  const pt = normStr(localize(teamName).pt);
  let best = 0;
  for (const name of [en, pt]) {
    let s = 0;
    if (name === q) s = 100;
    else if (name.startsWith(q)) s = 80;
    else if (name.includes(q)) s = 60;
    else if (q.length >= 3 && name.split(" ").some((w) => w.startsWith(q))) s = 40;
    else if (q.length >= 3 && q.split(" ").some((qw) => qw.length >= 3 && name.includes(qw))) s = 20;
    if (s > best) best = s;
  }
  return best;
}

function findMatch(matches, teamAQuery, teamBQuery) {
  let best = null;
  let bestScore = 0;
  let ambiguous = false;

  for (const m of matches) {
    // Orientação normal: A=home, B=away
    const normalScore = Math.min(scoreTeam(teamAQuery, m.home_team), scoreTeam(teamBQuery, m.away_team));
    // Orientação invertida: A=away, B=home
    const reversedScore = Math.min(scoreTeam(teamAQuery, m.away_team), scoreTeam(teamBQuery, m.home_team));

    const score = Math.max(normalScore, reversedScore);
    if (score < 20) continue;

    if (score > bestScore) {
      bestScore = score;
      best = { match: m, reversed: reversedScore > normalScore };
      ambiguous = false;
    } else if (score === bestScore && best) {
      ambiguous = true;
    }
  }

  if (ambiguous) return { match: null, reversed: false, ambiguous: true };
  return { match: best?.match || null, reversed: best?.reversed || false, ambiguous: false };
}

function fmtKickoff(kickoffAt) {
  const d = new Date(kickoffAt);
  const date = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

// ─── Inline palpite ───────────────────────────────────────────────────────────

async function handleInlinePalpite(client, chatId, userId, teamAQuery, goalsA, goalsB, teamBQuery) {
  const send = (text) => client.sendMessage(chatId, text);

  let matches = [];
  try {
    const res = await worldcupClient.getNextMatches(50, 0);
    matches = (res?.matches || []).filter((m) => m.status === "scheduled" || m.status === "live");
  } catch (e) {
    logger.error("[palpite inline] getNextMatches:", e.message);
    await send("❌ Erro ao buscar jogos. Tente */palpite* para abrir o menu.");
    return;
  }

  if (!matches.length) {
    await send("⚽ Nenhum jogo disponível para palpites no momento.");
    return;
  }

  const { match, reversed, ambiguous } = findMatch(matches, teamAQuery, teamBQuery);

  if (ambiguous) {
    await send(
      "🤔 Encontrei mais de um jogo que pode ser esse. Use */palpite* para escolher pelo menu.",
    );
    return;
  }

  if (!match) {
    await send(
      `⚽ Não encontrei um jogo entre *${teamAQuery}* e *${teamBQuery}* na agenda.\n\nUse */palpite* para ver todos os jogos disponíveis.`,
    );
    return;
  }

  // Ajusta placar conforme orientação do time no jogo
  const predictedHome = reversed ? goalsB : goalsA;
  const predictedAway = reversed ? goalsA : goalsB;
  const isDraw = predictedHome === predictedAway;
  const isKnockout = match.stage && match.stage !== "group";

  const { date, time } = fmtKickoff(match.kickoff_at);
  const stateKey = userId;

  // Empate em eliminatória → precisa saber quem avança
  if (isDraw && isKnockout) {
    conversationState.startFlow(stateKey, "copa-palpite-input", {
      step: "await_advancing",
      matchId: match.id,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      kickoffAt: match.kickoff_at,
      venue: match.venue,
      stage: match.stage,
      predictedHome,
      predictedAway,
      userId,
    });

    const options = [
      `${withFlag(match.home_team)} ${localize(match.home_team).pt} avança`,
      `${withFlag(match.away_team)} ${localize(match.away_team).pt} avança`,
    ];
    const pollMeta = {
      actionType: "menu",
      flowId: "copa-palpite",
      path: "/advancing",
      userId: stateKey,
      options: [
        { index: 0, label: options[0], action: "exec", handler: "setAdvancingTeam", data: { team: match.home_team, stateKey } },
        { index: 1, label: options[1], action: "exec", handler: "setAdvancingTeam", data: { team: match.away_team, stateKey } },
      ],
    };
    await polls.createPoll(
      client, chatId,
      `🔮 Empate! ${matchup(match.home_team, match.away_team)}\nQuem avança nos pênaltis?`,
      options, { metadata: pollMeta, sender: client },
    );
    return;
  }

  // Confirmação normal
  conversationState.startFlow(stateKey, "copa-palpite-input", {
    step: "await_confirmation",
    matchId: match.id,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    kickoffAt: match.kickoff_at,
    venue: match.venue,
    stage: match.stage,
    predictedHome,
    predictedAway,
    advancingTeam: null,
    userId,
  });

  const title =
    `🎯 Confirmar palpite?\n${matchup(match.home_team, match.away_team)}\n` +
    `*${predictedHome} x ${predictedAway}* · ${date} ${time}`;

  const pollMeta = {
    actionType: "menu",
    flowId: "copa-palpite",
    path: "/confirm",
    userId: stateKey,
    options: [
      {
        index: 0, label: "✅ Confirmar", action: "exec", handler: "confirmPrediction",
        data: {
          matchId: match.id, homeTeam: match.home_team, awayTeam: match.away_team,
          kickoffAt: match.kickoff_at, venue: match.venue, stage: match.stage,
          predictedHome, predictedAway, userId,
        },
      },
      {
        index: 1, label: "✏️ Corrigir placar", action: "exec", handler: "correctPrediction",
        data: {
          matchId: match.id, homeTeam: match.home_team, awayTeam: match.away_team,
          kickoffAt: match.kickoff_at, venue: match.venue, stage: match.stage, userId,
        },
      },
      {
        index: 2, label: "❌ Cancelar", action: "exec", handler: "cancelPrediction",
        data: { userId },
      },
    ],
  };

  await polls.createPoll(client, chatId, title, ["✅ Confirmar", "✏️ Corrigir placar", "❌ Cancelar"], {
    metadata: pollMeta,
  });
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  name: "palpite",
  aliases: ["palpites", "apostar", "apostas", "bet", "bets", "predict", "prediction"],
  description: "Palpite da Copa. /palpite ou /palpite portugal 2x1 argelia",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    if (isGroup) {
      await client.sendMessage(
        chatId,
        "⚽ Os palpites são feitos no privado!\nEnvie */palpite* diretamente para mim no privado.",
      );
      return;
    }

    let userId = message.from;
    try {
      const contact = await message.getContact();
      if (contact?.id?._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[palpite] getContact error:", e.message);
    }

    // Verifica grupo ativo
    try {
      const chatsRaw = await client.getChats();
      const groupIds = chatsRaw
        .filter((c) => c.isGroup)
        .map((c) => c.id._serialized || c.id.user + "@g.us");
      const { hasGroup } = await worldcupClient.userHasActiveGroup(userId, groupIds);
      if (!hasGroup) {
        await client.sendMessage(
          chatId,
          "⚽ Você precisa estar em um grupo com o sistema Copa ativado para fazer palpites.\nPeça para alguém enviar */clima-de-copa* no grupo.",
        );
        return;
      }
    } catch (e) {
      logger.error("[palpite] group check error:", e.message);
    }

    // ── Tenta formato inline: /palpite portugal 2x1 argelia ─────────────────
    const bodyArgs = (message.body || "").replace(/^[!/]\S+\s*/, "").trim();
    const inlineMatch = bodyArgs.match(INLINE_RE);
    if (inlineMatch) {
      const [, teamAQuery, goalsA, goalsB, teamBQuery] = inlineMatch;
      await handleInlinePalpite(
        client, chatId, userId,
        teamAQuery.trim(), parseInt(goalsA, 10), parseInt(goalsB, 10), teamBQuery.trim(),
      );
      return;
    }

    // ── Fluxo normal ─────────────────────────────────────────────────────────
    try {
      await flowManager.startFlow(client, chatId, userId, "copa-palpite");
    } catch (e) {
      await client.sendMessage(chatId, "❌ Erro ao abrir palpite: " + e.message);
    }
  },
};
