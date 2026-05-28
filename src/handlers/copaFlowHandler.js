"use strict";

const conversationState = require("../services/conversationState");
const worldcupClient = require("../services/worldcupClient");
const { matchup, withFlag } = require("../utils/teamLocale");
const logger = require("../utils/logger");

// Aceita "2-1", "2x1", "2 1", "2 - 1"
const SCORE_RE = /^\s*(\d{1,2})\s*[-x ]\s*(\d{1,2})\s*$/i;

async function handleCopaFlow(stateKey, body, state, reply) {
  const data = state.data || {};

  if (data.step !== "await_score") {
    conversationState.clearState(stateKey);
    return false;
  }

  const trimmed = body.trim();

  const m = trimmed.match(SCORE_RE);
  if (!m) {
    await reply(
      "❌ Formato inválido. Digite o placar assim: *2-1*\n" +
      `Isso significa ${data.homeTeam} 2, ${data.awayTeam} 1\n\n` +
      "_(ou /cancelar para sair)_",
    );
    return true;
  }

  const predictedHome = parseInt(m[1], 10);
  const predictedAway = parseInt(m[2], 10);
  const userId = data.userId || stateKey;

  try {
    await worldcupClient.submitPrediction(userId, data.matchId, predictedHome, predictedAway);
    conversationState.clearState(stateKey);

    const kickoff = new Date(data.kickoffAt);
    const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
    const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

    const lines = [
      "✅ *Palpite salvo!*",
      "",
      `⚽ *${matchup(data.homeTeam, data.awayTeam)}*`,
      `Placar: *${predictedHome} x ${predictedAway}*`,
      `📅 ${date} às ${time}`,
    ];
    if (data.venue) lines.push(`🏟 ${data.venue}`);
    lines.push("", "Use */palpite* para fazer mais palpites ou editar este até o início do jogo.");

    await reply(lines.join("\n"));
    logger.info(`[copa-palpite] palpite salvo: ${userId.split("@")[0]} — ${data.homeTeam} ${predictedHome}x${predictedAway} ${data.awayTeam}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg =
      e.message === "match_already_started"
        ? "❌ Este jogo já começou, palpites encerrados."
        : `❌ Erro ao salvar palpite: ${e.message}`;
    await reply(msg);
    logger.error("[copa-palpite] submitPrediction:", e.message);
  }

  return true;
}

module.exports = { handleCopaFlow };
