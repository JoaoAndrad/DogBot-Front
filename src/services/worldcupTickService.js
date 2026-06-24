"use strict";

const crypto = require("crypto");
const logger = require("../utils/logger");
const { withFlag, matchup, localize } = require("../utils/teamLocale");

const PLAYER_PHOTO_URL = (id) => `https://media.api-sports.io/football/players/${id}.png`;
const PLACEHOLDER_HASH = "2ff7d52a628fce5d954c58480dde4e47396db4bb405b7b7d6a6567134bf86422";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const goat = (n) => {
  if (!n) return n;
  if (/messi/i.test(n)) return `${n} 🐐`;
  if (/cristiano\s+ronaldo|c\.?\s*ronaldo/i.test(n)) return `${n} 💩`;
  return n;
};

function fmtKickoff(kickoffAt) {
  const d = new Date(kickoffAt);
  const date = d.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
  const time = d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { date, time };
}

function fmtStage(match) {
  if (match.group_name)
    return `Grupo ${match.group_name.replace("GROUP_", "").replace("Group ", "")}`;
  const map = {
    round_of_16: "16 avos",
    quarter_final: "Quartas",
    semi_final: "Semifinal",
    third_place: "3º Lugar",
    final: "Final",
  };
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
    map[p.userId] =
      p.pushName || p.displayName || phone || p.userId.slice(0, 8);
  }
  return map;
}

/** Constrói JID WhatsApp a partir do senderNumber. */
function toJid(senderNumber) {
  if (!senderNumber) return null;
  const num = String(senderNumber).trim();
  return num.includes("@") ? num : `${num}@c.us`;
}

function formatPredictionsBlock(predictions, currentHome, currentAway, opts) {
  const { text } = formatPredictionsBlockWithMentions(
    predictions,
    currentHome,
    currentAway,
    opts,
  );
  return text;
}

/**
 * Formata bloco de palpites agrupado por resultado apostado (vitória casa / empate / vitória visitante).
 * Quando todos ainda concorrem (início do jogo): sem cabeçalho de seção, apenas os três grupos.
 * Quando há perdedores: seções "Ainda concorrendo" e "Já perderam", cada uma com os três sub-grupos.
 * opts: { homeTeam, awayTeam } para labels das categorias.
 */
function formatPredictionsBlockWithMentions(
  predictions,
  currentHome,
  currentAway,
  opts = {},
) {
  if (!predictions || !predictions.length)
    return { text: null, mentionIds: [] };

  const { homeTeam, awayTeam } = opts;
  const nameMap = buildNameMap(predictions);
  const { competing, lost } = categorizePredictions(
    predictions,
    currentHome,
    currentAway,
  );
  const mentionIds = [];

  const homeLabel = homeTeam
    ? `Vitória ${withFlag(homeTeam)}`
    : "Vitória (casa)";
  const awayLabel = awayTeam
    ? `Vitória ${withFlag(awayTeam)}`
    : "Vitória (visitante)";

  function byOutcome(preds) {
    return {
      homeWin: preds.filter((p) => p.predictedHome > p.predictedAway),
      draw: preds.filter((p) => p.predictedHome === p.predictedAway),
      awayWin: preds.filter((p) => p.predictedHome < p.predictedAway),
    };
  }

  function renderPred(p, asMention) {
    if (asMention) {
      const jid = toJid(p.senderNumber);
      if (jid) {
        mentionIds.push(jid);
        return `  • @${String(p.senderNumber).split("@")[0]} — ${p.predictedHome}x${p.predictedAway}`;
      }
    }
    return `  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway}`;
  }

  function renderOutcomeGroups(preds, asMention) {
    const lines = [];
    const { homeWin, draw, awayWin } = byOutcome(preds);
    if (homeWin.length) {
      lines.push(`\n*${homeLabel}:*`);
      homeWin.forEach((p) => lines.push(renderPred(p, asMention)));
    }
    if (draw.length) {
      lines.push(`\n*Empate:*`);
      draw.forEach((p) => lines.push(renderPred(p, asMention)));
    }
    if (awayWin.length) {
      lines.push(`\n*${awayLabel}:*`);
      awayWin.forEach((p) => lines.push(renderPred(p, asMention)));
    }
    return lines;
  }

  const lines = ["", "📊 *Palpites:*"];

  if (!lost.length) {
    // Todos ainda concorrem (início do jogo): sem cabeçalho de seção
    lines.push(...renderOutcomeGroups(competing, true));
  } else {
    if (competing.length) {
      lines.push("\n✅ *Ainda concorrendo:*");
      lines.push(...renderOutcomeGroups(competing, true));
    }
    if (lost.length) {
      lines.push(
        `\n❌ *${lost.length === 1 ? "Já perdeu" : "Já perderam"} 🤣:*`,
      );
      lines.push(...renderOutcomeGroups(lost, false));
    }
  }

  return { text: lines.join("\n"), mentionIds };
}

function formatFinishedBlock(predictions, finalHome, finalAway) {
  if (!predictions || !predictions.length) return null;

  const nameMap = buildNameMap(predictions);
  const { exact, winner, wrong } = categorizeFinished(
    predictions,
    finalHome,
    finalAway,
  );
  const isDraw = finalHome === finalAway;
  const lines = ["", "🏆 *Palpites:*"];

  if (exact.length) {
    lines.push("🎯 *Placar exato — 3 pts*");
    for (const p of exact)
      lines.push(
        `  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway} ✓`,
      );
  }

  if (winner.length) {
    lines.push(
      isDraw ? "✓ *Acertou o empate — 1 pt*" : "✓ *Vencedor certo — 1 pt*",
    );
    for (const p of winner)
      lines.push(
        `  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway}`,
      );
  }

  if (wrong.length) {
    lines.push("❌ *Sem pontos*");
    for (const p of wrong)
      lines.push(
        `  • ${nameMap[p.userId]} — ${p.predictedHome}x${p.predictedAway}`,
      );
  }

  return lines.join("\n");
}

// ─── Goal context logic (13 combinations) ────────────────────────────────────

function getGoalText({
  prevHome = 0,
  prevAway = 0,
  newHome,
  newAway,
  homeTeam,
  awayTeam,
  scorer,
  minute,
  stage,
  allScorers = [],
}) {
  const homeScored = newHome > prevHome;
  const scoringTeam = homeScored ? homeTeam : awayTeam;
  const scoringTeamPrev = homeScored ? prevHome : prevAway;
  const otherTeamPrev = homeScored ? prevAway : prevHome;

  const isKnockout = stage && stage !== "group";
  const isExtraTime = minute != null && minute > 90;
  const isAddedTime = minute != null && minute >= 88 && !isExtraTime;
  const isHalfTimeEnd = minute != null && minute >= 43 && minute <= 45;
  const isFirst = prevHome === 0 && prevAway === 0;

  // Hat-trick / brace detection
  const scorerGoalCount = scorer
    ? allScorers.filter((n) => n && n.toLowerCase() === scorer.toLowerCase())
        .length
    : 0;

  // Timing suffix
  let timing = "";
  if (isExtraTime) timing = " na prorrogação";
  else if (isAddedTime) timing = " nos acréscimos";
  else if (isHalfTimeEnd) timing = " no fim do primeiro tempo";

  const name = goat(scorer) || null;
  const flag = withFlag(scoringTeam);

  // Prefixo: com nome do marcador, ou com flag do time como fallback
  const by = (text) => (name ? `*${name} ${text}` : `${flag} *${text}`);
  const gol = (text) => (name ? `⚽ *${name} ${text}` : `${flag} *${text}`);

  // Priority order ─────────────────────────────────

  // 13. Hat-trick
  if (name && scorerGoalCount >= 3)
    return `🎩 *HAT-TRICK de ${name}!*${timing}`;

  // 12. Brace
  if (name && scorerGoalCount === 2)
    return `🔁 *${name} marca de novo!*${timing}`;

  // 10. Knockout + empate nos acréscimos
  if (isKnockout && scoringTeamPrev === otherTeamPrev - 1 && isAddedTime)
    return `🤯 ${by(`empata nos acréscimos!*`)} Caminho para os pênaltis...`;

  // 9. Knockout + empate
  if (isKnockout && scoringTeamPrev === otherTeamPrev - 1)
    return `🔥 ${by(`empata para ${flag}!*${timing}`)} Caminho para os pênaltis...`;

  // 11. Knockout + toma a frente (virada)
  if (isKnockout && scoringTeamPrev === otherTeamPrev)
    return `🚨 ${by(`vira o jogo!*${timing}`)} ${flag} na frente na ${formatStage(stage)}.`;

  // 9 (alt). Knockout + abre
  if (isKnockout && isFirst)
    return `⚡ ${by(`abre o placar!*${timing}`)} Gol decisivo na ${formatStage(stage)}!`;

  // 7. Abre o placar
  if (isFirst) return `${gol(`abre o placar!*${timing}`)}`;

  // 8 (acréscimos). Empate nos acréscimos
  if (scoringTeamPrev === otherTeamPrev - 1 && isAddedTime)
    return `🤯 ${by(`empata nos acréscimos!*`)}`;

  // 8. Empata
  if (scoringTeamPrev === otherTeamPrev - 1)
    return `${gol(`empata para ${flag}!*${timing}`)}`;

  // 9 (alt). Toma a frente de empate
  if (scoringTeamPrev === otherTeamPrev)
    return `${gol(`coloca ${flag} na frente!*${timing}`)}`;

  // 4. Amplia
  if (scoringTeamPrev > otherTeamPrev) return `${gol(`amplia!*${timing}`)}`;

  // 5. Desconta
  if (scoringTeamPrev < otherTeamPrev - 1)
    return `${gol(`desconta para ${flag}!*${timing}`)}`;

  return name
    ? `⚽ *Gol de ${name}!*${timing}`
    : `⚽ *Goooool de ${flag}!*${timing}`;
}

function formatStage(stage) {
  const map = {
    round_of_16: "oitavas",
    round_of_32: "16 avos",
    quarter_final: "quartas",
    semi_final: "semifinal",
    third_place: "disputa de 3º",
    final: "final",
  };
  return map[stage] || stage;
}

// ─── Group member filtering ───────────────────────────────────────────────────

/**
 * Retorna o Set de JIDs dos membros de um grupo.
 * Retorna null se não conseguir obter (fallback: mostrar todos).
 */
async function getGroupMemberJids(client, groupId) {
  try {
    const chat = await client.getChatById(groupId);
    if (!chat || !chat.isGroup) return null;
    return new Set((chat.participants || []).map((p) => p.id._serialized));
  } catch (_) {
    return null;
  }
}

/**
 * Filtra predictions para exibir apenas usuários membros do grupo.
 * Se memberJids for null (falha ao obter membros), retorna todos.
 */
function filterForGroup(predictions, memberJids) {
  if (!memberJids || !predictions) return predictions || [];
  return predictions.filter(
    (p) => p.senderNumber && memberJids.has(toJid(p.senderNumber)),
  );
}

// ─── Action handlers ──────────────────────────────────────────────────────────

async function handleKickoff(client, action) {
  const { match, predictions, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const { time } = fmtKickoff(match.kickoff_at);
  const stage = fmtStage(match);

  for (const groupId of groupIds) {
    try {
      const memberJids = await getGroupMemberJids(client, groupId);
      const groupPreds = filterForGroup(predictions, memberJids);

      const lines = [
        `⚽ *Jogo começou!*`,
        ``,
        `${matchup(match.home_team, match.away_team)}`,
        `🕐 ${time} · ${stage}`,
        ``,
        `🔒 Palpites encerrados — boa sorte! 🍀`,
      ];

      let mentionIds = [];
      if (groupPreds.length) {
        const { text: predBlock, mentionIds: ids } =
          formatPredictionsBlockWithMentions(groupPreds, 0, 0, {
            homeTeam: match.home_team,
            awayTeam: match.away_team,
          });
        if (predBlock) lines.push(``, predBlock);
        mentionIds = ids;
      }

      await sendWithMentions(client, groupId, lines.join("\n"), mentionIds);
    } catch (e) {
      logger.warn(`[worldcupTick] kickoff → ${groupId}:`, e.message);
    }
  }
}

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
    try {
      await client.sendMessage(groupId, msg);
    } catch (e) {
      logger.warn(`[worldcupTick] reminder_24h → ${groupId}:`, e.message);
    }
  }
}

async function handleReminder1h(client, action) {
  const { match, groupIds, predictions = [] } = action;
  if (!groupIds || !groupIds.length) return;

  const dmAlertState = require("./dmAlertState");
  const worldcupClient = require("./worldcupClient");

  const { time } = fmtKickoff(match.kickoff_at);
  const stage = fmtStage(match);

  const predictedJids = new Set(
    predictions.map((p) => toJid(p.senderNumber)).filter(Boolean),
  );

  const dmOptedOut = new Set(
    (action.dmOptedOutNumbers || []).map((n) => toJid(n)),
  );
  const palpiteiros = new Set(
    (action.palpiteiroNumbers || []).map((n) => toJid(n)),
  );

  const botJid =
    (client.info && client.info.wid && client.info.wid._serialized) ||
    (client.info && client.info.me && client.info.me._serialized) ||
    null;

  const allUnpredictedJids = new Set();

  for (const groupId of groupIds) {
    try {
      const memberJids = await getGroupMemberJids(client, groupId);

      // Palpiteiros que ainda não palpitaram este jogo → mencionados com @
      const unpredictedPalpiteiros = memberJids
        ? [...memberJids].filter(
            (jid) =>
              jid.endsWith("@c.us") &&
              !predictedJids.has(jid) &&
              !dmOptedOut.has(jid) &&
              palpiteiros.has(jid) &&
              jid !== botJid,
          )
        : [];

      // Quem nunca palpitou → nome simples (sem expor número)
      const unpredictedOthers = memberJids
        ? [...memberJids].filter(
            (jid) =>
              jid.endsWith("@c.us") &&
              !predictedJids.has(jid) &&
              !palpiteiros.has(jid) &&
              !dmOptedOut.has(jid) &&
              jid !== botJid,
          )
        : [];

      const otherNames = [];
      for (const jid of unpredictedOthers) {
        try {
          const contact = await client.getContactById(jid);
          const name = contact?.pushname || contact?.name || null;
          if (name) otherNames.push(name);
        } catch {}
      }

      const lines = [
        `⏰ *Em 1 hora: ${matchup(match.home_team, match.away_team)}*`,
        `🕐 Hoje às ${time} · ${stage}`,
        ``,
        `🎯 Último chamado para palpites!`,
      ];

      const hasUnpredicted = unpredictedPalpiteiros.length || otherNames.length;
      if (hasUnpredicted) {
        lines.push(``, `Ainda não palpitaram:`);
        for (const jid of unpredictedPalpiteiros) {
          lines.push(`  • @${jid.split("@")[0]}`);
        }
        for (const name of otherNames) {
          lines.push(`  • ${name}`);
        }
        lines.push(
          ``,
          `Envie */palpite* no privado agora para participar! 🎯`,
          ``,
          `Ou */alertaoff* para parar de receber esse tipo de notificação`,
        );
      }

      await sendWithMentions(client, groupId, lines.join("\n"), unpredictedPalpiteiros);

      for (const jid of unpredictedPalpiteiros) allUnpredictedJids.add(jid);
    } catch (e) {
      logger.warn(`[worldcupTick] reminder_1h → ${groupId}:`, e.message);
    }
  }

  // DM individual — apenas para quem já fez pelo menos 1 palpite
  const homePt = localize(match.home_team).pt;
  const awayPt = localize(match.away_team).pt;

  const dmText = [
    `⏰ *Falta 1 hora para: ${matchup(match.home_team, match.away_team)}!*`,
    ``,
    `Você ainda não fez seu palpite para este jogo.`,
    `Envie */palpite* agora para participar! 🎯`,
    ``,
    `Ou */alertaoff* para parar de receber esse tipo de notificação`,
  ].join("\n");

  const dmAtalhText = `💡 *Atalho rápido:* */palpite ${homePt} 1x0 ${awayPt}*`;

  for (const jid of allUnpredictedJids) {
    if (dmOptedOut.has(jid)) continue;
    if (palpiteiros.size > 0 && !palpiteiros.has(jid)) continue;
    try {
      await client.sendMessage(jid, dmText);
      await client.sendMessage(jid, dmAtalhText);

      // Registra alerta ignorado; auto-desativa após MAX_IGNORED jogos consecutivos sem palpite
      const count = dmAlertState.recordAlert(jid, match.id);
      if (count >= dmAlertState.MAX_IGNORED) {
        logger.info(
          `[worldcupTick] auto-desativando alertas DM para ${jid} (${count} ignorados)`,
        );
        dmAlertState.markAutoDisabled(jid);
        worldcupClient.setDmAlerts(jid, false).catch((e) => {
          logger.debug(
            `[worldcupTick] setDmAlerts(false) error for ${jid}:`,
            e.message,
          );
        });
      }
    } catch (e) {
      logger.warn(`[worldcupTick] reminder_1h DM → ${jid}:`, e.message);
    }
  }
}

async function sendWithMentions(client, chatId, body, mentionJids) {
  const jids = (mentionJids || []).filter(Boolean);
  if (!jids.length) return client.sendMessage(chatId, body);

  try {
    return await client.sendMessage(chatId, body, { mentions: jids });
  } catch (e) {
    logger.warn("[worldcupTick] mentions fallback:", e.message);
  }
  return client.sendMessage(chatId, body);
}

async function fetchScorerSticker(scorerId) {
  if (!scorerId) return null;
  try {
    const res = await fetch(PLAYER_PHOTO_URL(scorerId));
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    if (hash === PLACEHOLDER_HASH) return null;
    const sharp = require("sharp");
    const webp = await sharp(buf).resize(512, 512, { fit: "cover" }).webp().toBuffer();
    return webp;
  } catch {
    return null;
  }
}

async function handleGoal(client, action) {
  const {
    match,
    scorer,
    scorerId,
    assist,
    goalDetail,
    minute,
    predictions,
    groupIds,
    prevHome = 0,
    prevAway = 0,
    allScorers = [],
  } = action;
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

  let scorerLine = "";
  if (scorer) {
    const detailTag =
      goalDetail === "Penalty"
        ? " *(pênalti)*"
        : goalDetail === "Own Goal"
          ? " *(gol contra)*"
          : "";
    scorerLine = `\n⚽ ${goat(scorer)}${minuteTag}${detailTag}`;
    if (assist && !detailTag) scorerLine += `\n🎯 Assistência: ${goat(assist)}`;
  }

  const stickerBuf = goalDetail !== "Own Goal" ? await fetchScorerSticker(scorerId) : null;

  for (const groupId of groupIds) {
    try {
      const memberJids = await getGroupMemberJids(client, groupId);
      const groupPreds = filterForGroup(predictions, memberJids);

      const { text: predBlock, mentionIds } = groupPreds.length
        ? formatPredictionsBlockWithMentions(
            groupPreds,
            match.home_score,
            match.away_score,
            { homeTeam: match.home_team, awayTeam: match.away_team },
          )
        : { text: null, mentionIds: [] };

      const lines = [
        goalText,
        ``,
        `*${withFlag(match.home_team)} ${score} ${withFlag(match.away_team)}*${scorerLine}`,
      ];
      if (predBlock) lines.push(predBlock);

      await sendWithMentions(client, groupId, lines.join("\n"), mentionIds);

      if (stickerBuf) {
        try {
          const { MessageMedia } = require("whatsapp-web.js");
          const media = new MessageMedia("image/webp", stickerBuf.toString("base64"));
          await client.sendMessage(groupId, media, { sendMediaAsSticker: true });
        } catch (e) {
          logger.debug(`[worldcupTick] sticker → ${groupId}:`, e.message);
        }
      }
    } catch (e) {
      logger.warn(`[worldcupTick] goal → ${groupId}:`, e.message);
    }
  }
}

const CARD_PT = {
  "Yellow Card": "Cartão Amarelo",
  "Red Card": "Cartão Vermelho",
  "Second Yellow card": "Segundo Amarelo",
};

async function handleCard(client, action) {
  const { match, card, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const isRed =
    card.detail === "Red Card" || card.detail === "Second Yellow card";
  const icon = isRed ? "🟥" : "🟨";
  const label = CARD_PT[card.detail] || card.detail;
  const minuteTag = card.minute ? ` ${card.minute}'` : "";
  const teamFlag = withFlag(card.team) || card.team;

  const msg = `${icon} *${label}*\n${card.player}${minuteTag} — ${teamFlag}`;

  for (const groupId of groupIds) {
    try {
      await client.sendMessage(groupId, msg);
    } catch (e) {
      logger.warn(`[worldcupTick] card → ${groupId}:`, e.message);
    }
  }
}

async function handleSub(client, action) {
  const { match, sub, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const minuteTag = sub.minute ? ` ${sub.minute}'` : "";
  const teamFlag = withFlag(sub.team) || sub.team;

  const msg = `🔄 *Substituição* — ${teamFlag}${minuteTag}\n⬆️ ${sub.in}\n⬇️ ${sub.out}`;

  for (const groupId of groupIds) {
    try {
      await client.sendMessage(groupId, msg);
    } catch (e) {
      logger.warn(`[worldcupTick] sub → ${groupId}:`, e.message);
    }
  }
}

async function handleHalftime(client, action) {
  const { match, predictions, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const score = `${match.home_score ?? 0} x ${match.away_score ?? 0}`;

  for (const groupId of groupIds) {
    try {
      const memberJids = await getGroupMemberJids(client, groupId);
      const groupPreds = filterForGroup(predictions, memberJids);

      const { text: predBlock, mentionIds } = groupPreds.length
        ? formatPredictionsBlockWithMentions(
            groupPreds,
            match.home_score ?? 0,
            match.away_score ?? 0,
            { homeTeam: match.home_team, awayTeam: match.away_team },
          )
        : { text: null, mentionIds: [] };

      const lines = [
        `⏸ *Intervalo*`,
        `${withFlag(match.home_team)} ${score} ${withFlag(match.away_team)}`,
      ];
      if (predBlock) lines.push(predBlock);

      await sendWithMentions(client, groupId, lines.join("\n"), mentionIds);
    } catch (e) {
      logger.warn(`[worldcupTick] halftime → ${groupId}:`, e.message);
    }
  }
}

async function handleResume(client, action) {
  const { match, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const score = `${match.home_score ?? 0} x ${match.away_score ?? 0}`;
  const msg = [
    `▶️ *Segundo tempo!*`,
    `${withFlag(match.home_team)} ${score} ${withFlag(match.away_team)}`,
  ].join("\n");

  for (const groupId of groupIds) {
    try {
      await client.sendMessage(groupId, msg);
    } catch (e) {
      logger.warn(`[worldcupTick] resume → ${groupId}:`, e.message);
    }
  }
}

async function handleExtraTime(client, action) {
  const { match, predictions, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const score = `${match.home_score ?? 0} x ${match.away_score ?? 0}`;

  for (const groupId of groupIds) {
    try {
      const memberJids = await getGroupMemberJids(client, groupId);
      const groupPreds = filterForGroup(predictions, memberJids);

      // Main preds block (90-min scores)
      const { text: predBlock, mentionIds: predMentions } = groupPreds.length
        ? formatPredictionsBlockWithMentions(
            groupPreds,
            match.home_score ?? 0,
            match.away_score ?? 0,
            { homeTeam: match.home_team, awayTeam: match.away_team },
          )
        : { text: null, mentionIds: [] };

      // ET-specific preds block
      const etPreds = groupPreds.filter((p) => p.predictedExtraHome != null);
      const etMentions = [];
      let etBlock = null;
      if (etPreds.length) {
        const etLines = etPreds.map((p) => {
          const jid = toJid(p.senderNumber);
          if (jid) etMentions.push(jid);
          return `  • @${String(p.senderNumber || "").split("@")[0]} — prorr. ${p.predictedExtraHome}x${p.predictedExtraAway}`;
        });
        etBlock = `⏱️ *Palpites de prorrogação:*\n${etLines.join("\n")}`;
      }

      const lines = [
        `⏱️ *Prorrogação!*`,
        `${withFlag(match.home_team)} *${score}* ${withFlag(match.away_team)} — empate nos 90min`,
        `Agora são mais 30 minutos!`,
      ];
      if (predBlock) lines.push(predBlock);
      if (etBlock) lines.push(etBlock);

      const allMentions = [...new Set([...predMentions, ...etMentions])];
      await sendWithMentions(client, groupId, lines.join("\n"), allMentions);
    } catch (e) {
      logger.warn(`[worldcupTick] extra_time → ${groupId}:`, e.message);
    }
  }
}

async function handlePenalties(client, action) {
  const { match, predictions, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const etScore = match.extra_time_home != null
    ? `${match.extra_time_home} x ${match.extra_time_away}`
    : `${match.home_score ?? 0} x ${match.away_score ?? 0}`;

  for (const groupId of groupIds) {
    try {
      const memberJids = await getGroupMemberJids(client, groupId);
      const groupPreds = filterForGroup(predictions, memberJids);

      // Pen-winner preds block
      const penPreds = groupPreds.filter((p) => p.penaltiesWinner);
      const penMentions = [];
      let penBlock = null;
      if (penPreds.length) {
        const penLines = penPreds.map((p) => {
          const jid = toJid(p.senderNumber);
          if (jid) penMentions.push(jid);
          return `  • @${String(p.senderNumber || "").split("@")[0]} — ${withFlag(p.penaltiesWinner)} ${p.penaltiesWinner}`;
        });
        penBlock = `🎯 *Palpites de pênaltis (quem avança):*\n${penLines.join("\n")}`;
      }

      const lines = [
        `🥅 *Pênaltis!*`,
        `${withFlag(match.home_team)} *${etScore}* ${withFlag(match.away_team)} — empate na prorrogação`,
        `Vai para a disputa de pênaltis!`,
      ];
      if (penBlock) lines.push(penBlock);

      await sendWithMentions(client, groupId, lines.join("\n"), penMentions);
    } catch (e) {
      logger.warn(`[worldcupTick] penalties → ${groupId}:`, e.message);
    }
  }
}

const VAR_PT = {
  "Goal cancelled": "Gol anulado",
  "Goal Disallowed": "Gol anulado",
  "Goal Disallowed - offside": "Gol anulado · impedimento",
  "Goal Disallowed - handball": "Gol anulado · mão na bola",
  "Goal Disallowed - foul": "Gol anulado · falta",
  "Penalty confirmed": "Pênalti confirmado",
  "Penalty cancelled": "Pênalti cancelado",
  "Card upgrade": "Cartão revisado",
  "Card cancelled": "Cartão cancelado",
};

async function handleMiss(client, action) {
  const { miss, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const minuteTag = miss.minute ? ` ${miss.minute}'` : "";
  const teamFlag = withFlag(miss.team) || miss.team || "";
  const msg = `❌ *Pênalti perdido!*\n${miss.player}${minuteTag} — ${teamFlag}`;

  for (const groupId of groupIds) {
    try {
      await client.sendMessage(groupId, msg);
    } catch (e) {
      logger.warn(`[worldcupTick] miss → ${groupId}:`, e.message);
    }
  }
}

async function handleGoalScorer(client, action) {
  const { scorerName, scorerId, assistName, goalDetail, minute, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const minuteTag = minute ? ` ${minute}'` : "";
  const detailTag =
    goalDetail === "Penalty"
      ? " *(pênalti)*"
      : goalDetail === "Own Goal"
        ? " *(gol contra)*"
        : "";
  let msg = `⚽ *Marcou:* ${goat(scorerName)}${minuteTag}${detailTag}`;
  if (assistName && !detailTag) msg += `\n🎯 *Assistência:* ${goat(assistName)}`;

  const stickerBuf = goalDetail !== "Own Goal" ? await fetchScorerSticker(scorerId) : null;

  for (const groupId of groupIds) {
    try {
      await client.sendMessage(groupId, msg);

      if (stickerBuf) {
        try {
          const { MessageMedia } = require("whatsapp-web.js");
          const media = new MessageMedia("image/webp", stickerBuf.toString("base64"));
          await client.sendMessage(groupId, media, { sendMediaAsSticker: true });
        } catch (e) {
          logger.debug(`[worldcupTick] sticker → ${groupId}:`, e.message);
        }
      }
    } catch (e) {
      logger.warn(`[worldcupTick] goal_scorer → ${groupId}:`, e.message);
    }
  }
}

async function handleVarRevert(client, action) {
  const { goal, predictions = [], groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const h = goal.homeScore ?? 0;
  const a = goal.awayScore ?? 0;

  for (const groupId of groupIds) {
    try {
      const memberJids = await getGroupMemberJids(client, groupId);
      const groupPreds = filterForGroup(predictions, memberJids);

      const { text: predBlock, mentionIds } = groupPreds.length
        ? formatPredictionsBlockWithMentions(groupPreds, h, a, {
            homeTeam: goal.homeTeam,
            awayTeam: goal.awayTeam,
          })
        : { text: null, mentionIds: [] };

      const lines = [
        `🚫 *VAR — Gol anulado*`,
        ``,
        `*${withFlag(goal.homeTeam)} ${h} x ${a} ${withFlag(goal.awayTeam)}*`,
      ];
      if (predBlock) lines.push(predBlock);

      await sendWithMentions(client, groupId, lines.join("\n"), mentionIds);
    } catch (e) {
      logger.warn(`[worldcupTick] var_revert → ${groupId}:`, e.message);
    }
  }
}

async function handleVar(client, action) {
  const { varEvent, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const isGoalCancel =
    varEvent.detail && varEvent.detail.toLowerCase().includes("goal");
  const label = VAR_PT[varEvent.detail] || varEvent.detail || "Decisão";
  const icon = isGoalCancel ? "🚫" : "📺";
  const minuteTag = varEvent.minute ? ` ${varEvent.minute}'` : "";
  const teamFlag = varEvent.team ? withFlag(varEvent.team) : "";
  const playerLine = varEvent.player
    ? `\n${varEvent.player}${minuteTag}${teamFlag ? ` — ${teamFlag}` : ""}`
    : teamFlag
      ? `\n${teamFlag}`
      : "";
  const msg = `${icon} *VAR — ${label}*${playerLine}`;

  for (const groupId of groupIds) {
    try {
      await client.sendMessage(groupId, msg);
    } catch (e) {
      logger.warn(`[worldcupTick] var → ${groupId}:`, e.message);
    }
  }
}

async function handleResultNotification(client, action) {
  const { match, predictions, groupIds } = action;
  if (!groupIds || !groupIds.length) return;

  const finalHome = match.home_score ?? 0;
  const finalAway = match.away_score ?? 0;
  const score = `${finalHome} x ${finalAway}`;
  const worldcupClient = require("./worldcupClient");
  const medals = ["🥇", "🥈", "🥉"];

  for (const groupId of groupIds) {
    try {
      const memberJids = await getGroupMemberJids(client, groupId);
      const groupPreds = filterForGroup(predictions, memberJids);

      const predBlock = groupPreds.length
        ? formatFinishedBlock(groupPreds, finalHome, finalAway)
        : null;

      const lines = [
        `🏁 *Fim de jogo!*`,
        ``,
        `${matchup(match.home_team, match.away_team)} — *${score}*`,
      ];
      if (predBlock) lines.push(predBlock);

      await client.sendMessage(groupId, lines.join("\n"));

      // Segunda mensagem: placar (bolão ou geral), fixada por 24h
      try {
        const memberJidsList = memberJids ? [...memberJids] : [];
        let rankingLines = null;

        const bolaoData = await worldcupClient
          .getBolao(groupId)
          .catch(() => null);
        if (
          bolaoData &&
          bolaoData.bolao &&
          bolaoData.leaderboard &&
          bolaoData.leaderboard.length
        ) {
          rankingLines = ["🎲 *Bolão da Copa — Ranking*", ""];
          for (let i = 0; i < bolaoData.leaderboard.length; i++) {
            const e = bolaoData.leaderboard[i];
            const name =
              e.pushName ||
              e.displayName ||
              (e.senderNumber ? e.senderNumber.split("@")[0] : "?");
            const pts = e.bolaoPoints === 1 ? "pt" : "pts";
            const count = e.predictionsScored || 0;
            rankingLines.push(
              `${medals[i] || `${i + 1}.`} ${name} — *${e.bolaoPoints} ${pts}* (${count})`,
            );
          }
          rankingLines.push("", "_Pontuação desde a criação do bolão_");

          // Ranking geral abaixo do bolão
          if (memberJidsList.length) {
            const { leaderboard: general } = await worldcupClient
              .getLeaderboard(groupId, memberJidsList)
              .catch(() => ({ leaderboard: [] }));
            if (general && general.length) {
              rankingLines.push(
                "",
                "──────────────────",
                "🏆 *Ranking Geral do Grupo*",
                "",
              );
              for (let i = 0; i < general.length; i++) {
                const e = general[i];
                const name =
                  e.pushName ||
                  e.displayName ||
                  (e.senderNumber ? e.senderNumber.split("@")[0] : "?");
                const pts = e.totalPoints === 1 ? "pt" : "pts";
                const count = e.predictionsScored || 0;
                rankingLines.push(
                  `${medals[i] || `${i + 1}.`} ${name} — *${e.totalPoints} ${pts}* (${count})`,
                );
              }
            }
          }
        } else if (memberJidsList.length) {
          const { leaderboard } = await worldcupClient
            .getLeaderboard(groupId, memberJidsList)
            .catch(() => ({ leaderboard: [] }));
          if (leaderboard && leaderboard.length) {
            rankingLines = ["🏆 *Ranking — Copa do Mundo*", ""];
            for (let i = 0; i < leaderboard.length; i++) {
              const e = leaderboard[i];
              const name =
                e.pushName ||
                e.displayName ||
                (e.senderNumber ? e.senderNumber.split("@")[0] : "?");
              const pts = e.totalPoints === 1 ? "pt" : "pts";
              const count = e.predictionsScored || 0;
              rankingLines.push(
                `${medals[i] || `${i + 1}.`} ${name} — *${e.totalPoints} ${pts}* (${count})`,
              );
            }
          }
        }

        if (rankingLines) {
          rankingLines.push("", "_Colocação - Nome - Pontuação - Palpites_");
          const rankMsg = await client.sendMessage(
            groupId,
            rankingLines.join("\n"),
          );
          if (rankMsg && typeof rankMsg.pin === "function") {
            await rankMsg.pin(86400).catch(() => {});
          }
        }
      } catch (rankErr) {
        logger.warn(
          `[worldcupTick] ranking após resultado → ${groupId}:`,
          rankErr.message,
        );
      }
    } catch (e) {
      logger.warn(
        `[worldcupTick] result_notification → ${groupId}:`,
        e.message,
      );
    }
  }
}

// ─── Weekly summary ──────────────────────────────────────────────────────────

async function handleWeeklySummary(client, action) {
  const { groupSummaries, recentMatches, weekOf } = action;
  if (!groupSummaries || !groupSummaries.length) return;

  const weekStart = weekOf
    ? new Date(weekOf).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
      })
    : "—";

  // Recap dos jogos da semana
  const matchLines = (recentMatches || []).map(
    (m) =>
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
        const jid = e.senderNumber ? `${e.senderNumber}@c.us` : null;
        const p =
          jid &&
          participants.find(
            (x) => (x.id._serialized || x.id.user + "@c.us") === jid,
          );
        const name =
          e.pushName ||
          e.displayName ||
          (p ? p.pushname || p.name : null) ||
          e.senderNumber ||
          e.userId.slice(0, 8);
        return `${medals[i] || `${e.rank}.`} ${name} — *${e.weeklyPoints} pts*`;
      });

      const craqueLabel = rankingLines.length
        ? `🏅 *${weeklyRanking[0] ? "Craque da semana" : ""}*`
        : "";

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

// action: { kind: "broadcast", groupIds: [...], message: "...", pin: true }
async function handleBroadcast(client, action) {
  const { groupIds, message, pin } = action;
  if (!groupIds || !groupIds.length || !message) return;
  for (const groupId of groupIds) {
    try {
      const msg = await client.sendMessage(groupId, message);
      if (pin && msg && typeof msg.pin === "function") {
        msg.pin(86400).catch(() => {});
      }
    } catch (e) {
      logger.warn(`[worldcupTick] broadcast → ${groupId}:`, e.message);
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
        case "kickoff":
          await handleKickoff(client, action);
          break;
        case "reminder_24h":
          await handleReminder24h(client, action);
          break;
        case "reminder_1h":
          await handleReminder1h(client, action);
          break;
        case "goal":
          await handleGoal(client, action);
          break;
        case "halftime":
          await handleHalftime(client, action);
          break;
        case "extra_time":
          await handleExtraTime(client, action);
          break;
        case "penalties":
          await handlePenalties(client, action);
          break;
        case "resume":
          await handleResume(client, action);
          break;
        case "card":
          await handleCard(client, action);
          break;
        case "sub":
          await handleSub(client, action);
          break;
        case "miss":
          await handleMiss(client, action);
          break;
        case "goal_scorer":
          await handleGoalScorer(client, action);
          break;
        case "var_revert":
          await handleVarRevert(client, action);
          break;
        case "var":
          await handleVar(client, action);
          break;
        case "result_notification":
          await handleResultNotification(client, action);
          break;
        case "weekly_summary":
          await handleWeeklySummary(client, action);
          break;
        case "match_reactivated":
          await handleMatchReactivated(client, action);
          break;
        case "bolao_member_added":
          await handleBolaoMemberAdded(client, action);
          break;
        case "bolao_member_removed":
          await handleBolaoMemberRemoved(client, action);
          break;
        case "broadcast":
          await handleBroadcast(client, action);
          break;
        default:
          logger.debug(`[worldcupTick] ação desconhecida: ${action.kind}`);
      }
    } catch (e) {
      logger.error(`[worldcupTick] erro em ${action.kind}:`, e.message);
    }
  }
}

// action: { kind, groupId, homeTeam, awayTeam }
async function handleMatchReactivated(client, action) {
  const { groupId, homeTeam, awayTeam } = action;
  const text = [
    `⚠️ *Atenção — erro na API*`,
    ``,
    `O jogo *${matchup(homeTeam, awayTeam)}* foi dado como encerrado incorretamente por uma falha no retorno da API, que devolveu dados de outra partida.`,
    ``,
    `O jogo foi *reativado* e as pontuações atribuídas foram *canceladas*. Os palpites continuam válidos normalmente. 🙏`,
  ].join("\n");
  await client.sendMessage(groupId, text);
}

// action: { kind, groupId, addedName, bolaoPoints }
async function handleBolaoMemberAdded(client, action) {
  const { groupId, addedName, bolaoPoints } = action;
  const pts = bolaoPoints != null ? bolaoPoints : 0;
  const ptsLabel = pts === 1 ? "1 pt" : `${pts} pts`;
  const text = [
    `🎲 *${addedName || "Participante"}* foi adicionado ao bolão!`,
    ``,
    `📊 Pontuação atual no bolão: *${ptsLabel}*`,
  ].join("\n");
  await client.sendMessage(groupId, text);
}

// action: { kind, groupId, removedName }
async function handleBolaoMemberRemoved(client, action) {
  const { groupId, removedName } = action;
  const text = [
    `🎲 *${removedName || "Participante"}* foi removido do bolão automaticamente por inadimplência.`,
    ``,
    `Caso seja re-adicionado futuramente, os pontos conquistados desde o início do bolão serão contabilizados normalmente.`,
  ].join("\n");
  await client.sendMessage(groupId, text);
}

module.exports = { processWorldCupTickPayload };
