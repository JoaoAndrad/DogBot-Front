"use strict";

const logger = require("../utils/logger");
const { withFlag, matchup } = require("../utils/teamLocale");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtKickoff(kickoffAt) {
  const d = new Date(kickoffAt);
  const date = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

function fmtStage(match) {
  if (match.group_name) return `Grupo ${match.group_name.replace("GROUP_", "").replace("Group ", "")}`;
  const map = { round_of_16: "16 avos", quarter_final: "Quartas", semi_final: "Semifinal", third_place: "3º Lugar", final: "Final" };
  return map[match.stage] || match.stage || "";
}

/**
 * Retorna { competing: [...], lost: [...] }
 * Um palpite ainda é possível se nenhum time já marcou MAIS do que o apostado.
 * Já perdeu se home > predictedHome OU away > predictedAway.
 */
function categorizePredictions(predictions, currentHome, currentAway) {
  const competing = [];
  const lost = [];
  for (const p of predictions || []) {
    if (currentHome > p.predictedHome || currentAway > p.predictedAway) {
      lost.push(p);
    } else {
      competing.push(p);
    }
  }
  return { competing, lost };
}

/**
 * Categoriza palpites ao final do jogo em: exact (3pts), winner (1pt), wrong (0pts).
 */
function categorizeFinished(predictions, finalHome, finalAway) {
  const exact = [];
  const winner = [];
  const wrong = [];
  const actualWinner = Math.sign(finalHome - finalAway);
  for (const p of predictions || []) {
    if (p.predictedHome === finalHome && p.predictedAway === finalAway) {
      exact.push(p);
    } else if (Math.sign(p.predictedHome - p.predictedAway) === actualWinner) {
      winner.push(p);
    } else {
      wrong.push(p);
    }
  }
  return { exact, winner, wrong };
}

/**
 * Constrói mapa de nomes a partir dos dados já incluídos nas predictions (vindos do DB).
 * Fallback: número de telefone ou fragmento do userId.
 */
function buildNameMap(predictions) {
  const map = {};
  for (const p of predictions || []) {
    const phone = p.senderNumber ? String(p.senderNumber).split("@")[0] : null;
    map[p.userId] = p.pushName || p.displayName || phone || p.userId.slice(0, 8);
  }
  return map;
}

/** Constrói JID WhatsApp a partir do senderNumber. */
function toJid(senderNumber) {
  if (!senderNumber) return null;
  const num = String(senderNumber).trim();
  return num.includes("@") ? num : `${num}@c.us`;
}

function formatPredictionsBlock(predictions, currentHome, currentAway) {
  const { text } = formatPredictionsBlockWithMentions(predictions, currentHome, currentAway);
  return text;
}

/**
 * Formata bloco de palpites e retorna JIDs dos usuários ainda concorrendo para mention.
 * Competing: mencionados com @telefone. Lost: nome do DB, sem mention.
 */
function formatPredictionsBlockWithMentions(predictions, currentHome, currentAway) {
  if (!predictions || !predictions.length) return { text: null, mentionIds: [] };

  const nameMap = buildNameMap(predictions);
  const { competing, lost } = categorizePredictions(predictions, currentHome, currentAway);
  const mentionIds = [];
  const lines = ["", "📊 *Palpites:*"];

  if (competing.length) {
    lines.push("✅ *Ainda concorrendo*");
    for (const p of competing) {
      const jid = toJid(p.senderNumber);
      if (jid) {
        mentionIds.push(jid);
        lines.push(`  • @${String(p.senderNumber).split("@")[0]} — ${p.predictedHome}x${p.predictedAway}`);
      } else {
        lines.push(`  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway}`);
      }
    }
  }

  if (lost.length) {
    lines.push("❌ *Já perderam*");
    for (const p of lost) {
      lines.push(`  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway}`);
    }
  }

  return { text: lines.join("\n"), mentionIds };
}

function formatFinishedBlock(predictions, finalHome, finalAway) {
  if (!predictions || !predictions.length) return null;

  const nameMap = buildNameMap(predictions);
  const { exact, winner, wrong } = categorizeFinished(predictions, finalHome, finalAway);
  const lines = ["", "🏆 *Palpites:*"];

  if (exact.length) {
    lines.push("🎯 *Placar exato — 3 pts*");
    for (const p of exact) lines.push(`  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway} ✓`);
  }

  if (winner.length) {
    lines.push("✓ *Vencedor certo — 1 pt*");
    for (const p of winner) lines.push(`  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway}`);
  }

  if (wrong.length) {
    lines.push("❌ *Sem pontos*");
    for (const p of wrong) lines.push(`  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway}`);
  }

  return lines.join("\n");
}

// ─── Goal context logic (13 combinations) ────────────────────────────────────

function getGoalText({ prevHome = 0, prevAway = 0, newHome, newAway, homeTeam, awayTeam, scorer, minute, stage, allScorers = [] }) {
  const homeScored = newHome > prevHome;
  const scoringTeam    = homeScored ? homeTeam : awayTeam;
  const scoringTeamPrev = homeScored ? prevHome : prevAway;
  const otherTeamPrev   = homeScored ? prevAway : prevHome;

  const isKnockout    = stage && stage !== "group";
  const isExtraTime   = minute != null && minute > 90;
  const isAddedTime   = minute != null && minute >= 88 && !isExtraTime;
  const isHalfTimeEnd = minute != null && minute >= 43 && minute <= 45;
  const isFirst       = prevHome === 0 && prevAway === 0;

  // Hat-trick / brace detection
  const scorerGoalCount = scorer
    ? allScorers.filter((n) => n && n.toLowerCase() === scorer.toLowerCase()).length
    : 0;

  // Timing suffix
  let timing = "";
  if (isExtraTime)   timing = " na prorrogação";
  else if (isAddedTime)   timing = " nos acréscimos";
  else if (isHalfTimeEnd) timing = " no fim do primeiro tempo";

  const name = scorer || "Gol";
  const flag = withFlag(scoringTeam);

  // Priority order ─────────────────────────────────

  // 13. Hat-trick
  if (scorerGoalCount >= 3) return `🎩 *HAT-TRICK de ${name}!*${timing}`;

  // 12. Brace
  if (scorerGoalCount === 2) return `🔁 *${name} marca de novo!*${timing}`;

  // 10. Knockout + empate nos acréscimos
  if (isKnockout && scoringTeamPrev === otherTeamPrev - 1 && isAddedTime)
    return `🤯 *${name} empata nos acréscimos!* Caminho para os pênaltis...`;

  // 9. Knockout + empate
  if (isKnockout && scoringTeamPrev === otherTeamPrev - 1)
    return `🔥 *${name} empata para ${flag} ${scoringTeam}!*${timing} Caminho para os pênaltis...`;

  // 11. Knockout + toma a frente (virada)
  if (isKnockout && scoringTeamPrev === otherTeamPrev)
    return `🚨 *${name} vira o jogo!*${timing} ${flag} ${scoringTeam} na frente na ${formatStage(stage)}.`;

  // 9 (alt). Knockout + abre
  if (isKnockout && isFirst)
    return `⚡ *${name} abre o placar!*${timing} Gol decisivo na ${formatStage(stage)}!`;

  // 7. Abre o placar
  if (isFirst) return `⚽ *${name} abre o placar!*${timing}`;

  // 8 (acréscimos). Empate nos acréscimos
  if (scoringTeamPrev === otherTeamPrev - 1 && isAddedTime)
    return `🤯 *${name} empata nos acréscimos!*`;

  // 8. Empata
  if (scoringTeamPrev === otherTeamPrev - 1)
    return `⚽ *${name} empata para ${flag} ${scoringTeam}!*${timing}`;

  // 9 (alt). Toma a frente de empate
  if (scoringTeamPrev === otherTeamPrev)
    return `⚽ *${name} coloca ${flag} ${scoringTeam} na frente!*${timing}`;

  // 4. Amplia
  if (scoringTeamPrev > otherTeamPrev)
    return `⚽ *${name} amplia!*${timing}`;

  // 5. Desconta
  if (scoringTeamPrev < otherTeamPrev - 1)
    return `⚽ *${name} desconta para ${flag} ${scoringTeam}!*${timing}`;

  return `⚽ *Gol de ${name}!*${timing}`;
}

function formatStage(stage) {
  const map = {
    round_of_16: "oitavas", round_of_32: "16 avos",
    quarter_final: "quartas", semi_final: "semifinal",
    third_place: "disputa de 3º", final: "final",
  };
  return map[stage] || stage;
}

// ─── Action handlers ──────────────────────────────────────────────────────────

async function handleReminder24h(client, action) {
  const { match, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const { date, time } = fmtKickoff(match.kickoff_at);
  const stage = fmtStage(match);
  const venue = match.venue ? `\n🏟 ${match.venue}` : "";

  const msg = [
    `⚽ *Amanhã tem jogo!*`,
    ``,
    matchup(match.home_team, match.away_team),
    `📅 ${date} às ${time}`,
    `📍 ${stage}${venue}`,
    ``,
    `Use */palpite* (no privado) para fazer seu palpite!`,
  ].join("\n");

  for (const groupId of groupIds) {
    try { await client.sendMessage(groupId, msg); }
    catch (e) { logger.warn(`[worldcupTick] reminder_24h → ${groupId}:`, e.message); }
  }
}

async function handleReminder1h(client, action) {
  const { match, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const { time } = fmtKickoff(match.kickoff_at);
  const stage = fmtStage(match);

  const msg = [
    `⏰ *Em 1 hora: ${matchup(match.home_team, match.away_team)}*`,
    `🕐 Hoje às ${time} · ${stage}`,
    ``,
    `🎯 Último chamado para palpites! Envie */palpite* no privado.`,
  ].join("\n");

  for (const groupId of groupIds) {
    try { await client.sendMessage(groupId, msg); }
    catch (e) { logger.warn(`[worldcupTick] reminder_1h → ${groupId}:`, e.message); }
  }
}

async function sendWithMentions(client, chatId, body, mentionJids) {
  const jids = (mentionJids || []).filter(Boolean);
  if (!jids.length) return client.sendMessage(chatId, body);

  // Padrão do bot: resolver contactos via getContactById antes de mencionar
  const contacts = await Promise.all(
    jids.map((jid) => client.getContactById(jid).catch(() => null)),
  );
  const valid = contacts.filter(Boolean);

  if (valid.length) {
    try {
      return await client.sendMessage(chatId, body, { mentions: valid });
    } catch (e) {
      logger.warn("[worldcupTick] mentions fallback:", e.message);
    }
  }
  return client.sendMessage(chatId, body);
}

async function handleGoal(client, action) {
  const { match, scorer, minute, predictions, groupIds, prevHome = 0, prevAway = 0, allScorers = [] } = action;
  if (!groupIds || !groupIds.length) return;

  const score = `${match.home_score} x ${match.away_score}`;
  const minuteTag = minute ? ` ${minute}'` : "";

  const goalText = getGoalText({
    prevHome,
    prevAway,
    newHome: match.home_score,
    newAway: match.away_score,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    scorer,
    minute,
    stage: match.stage,
    allScorers,
  });

  const scorerTag = scorer ? `\n${scorer}${minuteTag}` : "";

  for (const groupId of groupIds) {
    try {
      const { text: predBlock, mentionIds } = predictions && predictions.length
        ? formatPredictionsBlockWithMentions(predictions, match.home_score, match.away_score)
        : { text: null, mentionIds: [] };

      const lines = [
        goalText,
        ``,
        `*${withFlag(match.home_team)} ${score} ${withFlag(match.away_team)}*${scorerTag}`,
      ];
      if (predBlock) lines.push(predBlock);

      await sendWithMentions(client, groupId, lines.join("\n"), mentionIds);
    } catch (e) {
      logger.warn(`[worldcupTick] goal → ${groupId}:`, e.message);
    }
  }
}

async function handleHalftime(client, action) {
  const { match, predictions, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const score = `${match.home_score ?? 0} x ${match.away_score ?? 0}`;

  for (const groupId of groupIds) {
    try {
      const predBlock = predictions && predictions.length
        ? formatPredictionsBlock(predictions, match.home_score ?? 0, match.away_score ?? 0)
        : null;

      const lines = [
        `⏸ *Intervalo*`,
        `${withFlag(match.home_team)} ${score} ${withFlag(match.away_team)}`,
      ];
      if (predBlock) lines.push(predBlock);

      await client.sendMessage(groupId, lines.join("\n"));
    } catch (e) {
      logger.warn(`[worldcupTick] halftime → ${groupId}:`, e.message);
    }
  }
}

async function handleResultNotification(client, action) {
  const { match, predictions, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const finalHome = match.home_score ?? 0;
  const finalAway = match.away_score ?? 0;
  const score = `${finalHome} x ${finalAway}`;

  for (const groupId of groupIds) {
    try {
      const predBlock = predictions && predictions.length
        ? formatFinishedBlock(predictions, finalHome, finalAway)
        : null;

      const lines = [
        `🏁 *Fim de jogo!*`,
        ``,
        `${matchup(match.home_team, match.away_team)} — *${score}*`,
      ];
      if (predBlock) lines.push(predBlock);
      if (predictions && predictions.length) {
        lines.push("", `Use */placar* para ver o ranking atualizado.`);
      }

      await client.sendMessage(groupId, lines.join("\n"));
    } catch (e) {
      logger.warn(`[worldcupTick] result_notification → ${groupId}:`, e.message);
    }
  }
}

// ─── Weekly summary ──────────────────────────────────────────────────────────

async function handleWeeklySummary(client, action) {
  const { groupSummaries, recentMatches, weekOf } = action;
  if (!groupSummaries || !groupSummaries.length) return;

  const weekStart = weekOf
    ? new Date(weekOf).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })
    : "—";

  // Recap dos jogos da semana
  const matchLines = (recentMatches || []).map((m) =>
    `• ${matchup(m.home_team, m.away_team)} — ${m.home_score}x${m.away_score}`,
  );

  for (const gs of groupSummaries) {
    const { groupId, weeklyRanking } = gs;
    if (!weeklyRanking || !weeklyRanking.length) continue;

    try {
      const chat = await client.getChatById(groupId);
      const participants = chat.participants || [];

      const medals = ["🥇", "🥈", "🥉"];
      const rankingLines = weeklyRanking.map((e, i) => {
        const p = participants.find(
          (x) => (x.id._serialized || x.id.user + "@c.us") === e.userId,
        );
        const name = p ? (p.pushname || p.name || e.userId.split("@")[0]) : e.userId.split("@")[0];
        return `${medals[i] || `${e.rank}.`} ${name} — *${e.weeklyPoints} pts*`;
      });

      const craqueLabel = rankingLines.length ? `🏅 *${weeklyRanking[0] ? "Craque da semana" : ""}*` : "";

      const lines = [
        `📊 *Resumo da semana — Copa 2026*`,
        `_Semana de ${weekStart}_`,
        ``,
      ];

      if (matchLines.length) {
        lines.push(`⚽ *Jogos da semana:*`);
        lines.push(...matchLines);
        lines.push(``);
      }

      lines.push(`🏆 *Ranking da semana:*`);
      lines.push(...rankingLines);

      await client.sendMessage(groupId, lines.join("\n"));
    } catch (e) {
      logger.warn(`[worldcupTick] weekly_summary → ${groupId}:`, e.message);
    }
  }
}

// ─── Main processor ───────────────────────────────────────────────────────────

async function processWorldCupTickPayload(client, payload) {
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  if (!actions.length) return;

  for (const action of actions) {
    try {
      switch (action.kind) {
        case "reminder_24h":       await handleReminder24h(client, action);       break;
        case "reminder_1h":        await handleReminder1h(client, action);        break;
        case "goal":               await handleGoal(client, action);              break;
        case "halftime":           await handleHalftime(client, action);          break;
        case "result_notification":await handleResultNotification(client, action);break;
        case "weekly_summary":     await handleWeeklySummary(client, action);     break;
        default: logger.debug(`[worldcupTick] ação desconhecida: ${action.kind}`);
      }
    } catch (e) {
      logger.error(`[worldcupTick] erro em ${action.kind}:`, e.message);
    }
  }
}

module.exports = { processWorldCupTickPayload };
