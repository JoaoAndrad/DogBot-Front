"use strict";

const conversationState = require("../services/conversationState");
const worldcupClient = require("../services/worldcupClient");
const polls = require("../components/poll");
const { matchup } = require("../utils/teamLocale");
const logger = require("../utils/logger");

// Aceita: "2-1", "2 - 1", "2x1", "2 X 1", "2 a 1", "2a1", "2 1"
const SCORE_RE = /^\s*(\d{1,2})\s*(?:[-xX]|[aA]|\s+)\s*(\d{1,2})\s*$/;

async function handleCopaFlow(stateKey, body, state, reply, opts) {
  const data = state.data || {};
  const client = opts && opts.client;
  const from = opts && opts.from;

  // ── Aguardando placar ─────────────────────────────────────────────────────
  if (data.step === "await_score") {
    const m = body.trim().match(SCORE_RE);
    if (!m) {
      await reply(
        "❌ Formato inválido. Exemplos aceitos:\n" +
        "*2-1*  •  *2 x 1*  •  *2 a 1*  •  *2 1*\n\n" +
        `(${data.homeTeam} 2, ${data.awayTeam} 1)\n\n_(ou /cancelar para sair)_`,
      );
      return true;
    }

    const predictedHome = parseInt(m[1], 10);
    const predictedAway = parseInt(m[2], 10);

    // Guarda o placar e aguarda confirmação
    conversationState.startFlow(stateKey, "copa-palpite-input", {
      ...data,
      step: "await_confirmation",
      predictedHome,
      predictedAway,
    });

    const kickoff = new Date(data.kickoffAt);
    const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
    const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

    const title = `🎯 Confirmar palpite?\n${matchup(data.homeTeam, data.awayTeam)}\n*${predictedHome} x ${predictedAway}* · ${date} ${time}`;
    const options = ["✅ Confirmar", "✏️ Corrigir placar", "❌ Cancelar"];

    const pollMeta = {
      actionType: "menu",
      flowId: "copa-palpite",
      path: "/confirm",
      userId: stateKey,
      options: [
        {
          index: 0, label: "✅ Confirmar",
          action: "exec", handler: "confirmPrediction",
          data: {
            matchId: data.matchId, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
            kickoffAt: data.kickoffAt, venue: data.venue,
            predictedHome, predictedAway, userId: data.userId || stateKey,
          },
        },
        {
          index: 1, label: "✏️ Corrigir placar",
          action: "exec", handler: "correctPrediction",
          data: {
            matchId: data.matchId, homeTeam: data.homeTeam, awayTeam: data.awayTeam,
            kickoffAt: data.kickoffAt, venue: data.venue,
            userId: data.userId || stateKey,
          },
        },
        {
          index: 2, label: "❌ Cancelar",
          action: "exec", handler: "cancelPrediction",
          data: { userId: data.userId || stateKey },
        },
      ],
    };

    if (client && from) {
      await polls.createPoll(client, from, title, options, { metadata: pollMeta });
    } else {
      await reply(`${title}\n\nDigite *1* confirmar, *2* corrigir ou *3* cancelar.`);
    }

    return true;
  }

  // ── Aguardando confirmação (fallback texto se não votou na enquete) ─────────
  if (data.step === "await_confirmation") {
    const t = body.trim();
    if (t === "1" || /^confirmar?$/i.test(t)) {
      await _submitPrediction(stateKey, data, reply);
    } else if (t === "2" || /^corrigir?$/i.test(t)) {
      conversationState.startFlow(stateKey, "copa-palpite-input", { ...data, step: "await_score" });
      const kickoff = new Date(data.kickoffAt);
      const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
      const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      await reply(
        `✏️ *${matchup(data.homeTeam, data.awayTeam)}*\n📅 ${date} às ${time}\n\n` +
        "Qual o novo placar? (*H-A*)\n_(ou /cancelar para sair)_",
      );
    } else if (t === "3" || /^cancelar?$/i.test(t)) {
      conversationState.clearState(stateKey);
      await reply("❌ Palpite cancelado.");
    } else {
      await reply("Digite *1* para confirmar, *2* para corrigir ou *3* para cancelar.");
    }
    return true;
  }

  conversationState.clearState(stateKey);
  return false;
}

async function _submitPrediction(stateKey, data, reply) {
  try {
    const userId = data.userId || stateKey;
    await worldcupClient.submitPrediction(userId, data.matchId, data.predictedHome, data.predictedAway);
    conversationState.clearState(stateKey);

    const kickoff = new Date(data.kickoffAt);
    const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
    const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

    const lines = [
      "✅ *Palpite salvo!*", "",
      `⚽ ${matchup(data.homeTeam, data.awayTeam)}`,
      `Placar: *${data.predictedHome} x ${data.predictedAway}*`,
      `📅 ${date} às ${time}`,
    ];
    if (data.venue) lines.push(`🏟 ${data.venue}`);
    lines.push("", "Use */palpite* para fazer mais palpites ou editar este até o início do jogo.");
    await reply(lines.join("\n"));
    logger.info(`[copa-palpite] palpite salvo: ${userId.split("@")[0]} — ${data.homeTeam} ${data.predictedHome}x${data.predictedAway} ${data.awayTeam}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = e.message === "match_already_started"
      ? "❌ Este jogo já começou, palpites encerrados."
      : `❌ Erro ao salvar palpite: ${e.message}`;
    await reply(msg);
    logger.error("[copa-palpite] submitPrediction:", e.message);
  }
}

module.exports = { handleCopaFlow, _submitPrediction };
