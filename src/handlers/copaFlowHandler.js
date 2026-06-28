"use strict";

const conversationState = require("../services/conversationState");
const worldcupClient = require("../services/worldcupClient");
const polls = require("../components/poll");
const { matchup, searchTeams, withFlag, localize } = require("../utils/teamLocale");
const logger = require("../utils/logger");
const dmAlertState = require("../services/dmAlertState");

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
    const isDraw = predictedHome === predictedAway;
    const isKnockout = data.stage && data.stage !== "group";

    // Empate em partida eliminatória → oferecer palpite opcional de prorrogação
    if (isDraw && isKnockout) {
      conversationState.startFlow(stateKey, "copa-palpite-input", {
        ...data,
        step: "await_et_opt",
        predictedHome,
        predictedAway,
      });
      const etOptions = ["⏱️ Sim, quero palpitar a prorrogação", "⏩ Não, pular para confirmação"];
      const pollMeta = {
        actionType: "menu",
        flowId: "copa-palpite",
        path: "/et-opt",
        userId: stateKey,
        options: [
          { index: 0, label: etOptions[0], action: "exec", handler: "acceptEtPrediction", data: { stateKey } },
          { index: 1, label: etOptions[1], action: "exec", handler: "skipEtPrediction",   data: { stateKey } },
        ],
      };
      await polls.createPoll(client || { sendPoll: async () => null }, from || data.userId || stateKey,
        `🎯 Empate! Quer palpitar o placar da *prorrogação*? (+1 pt bônus)`,
        etOptions, { metadata: pollMeta });
      if (!client || !from) {
        await reply("⏱️ Responda na enquete acima.");
      }
      return true;
    }

    // Guarda o placar e aguarda confirmação
    conversationState.startFlow(stateKey, "copa-palpite-input", {
      ...data,
      step: "await_confirmation",
      predictedHome,
      predictedAway,
      advancingTeam: null,
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

    await polls.createPoll(client, from, title, options, { metadata: pollMeta });

    return true;
  }

  // ── Aguardando quem avança (usuário deve votar na enquete) ──────────────────
  if (data.step === "await_advancing") {
    await reply("⚽ Vote na enquete acima para indicar quem avança.\n_(ou /cancelar para sair)_");
    return true;
  }

  // ── Aguardando opção de prorrogação (usuário deve votar na enquete) ──────────
  if (data.step === "await_et_opt") {
    await reply("⏱️ Vote na enquete acima para continuar.\n_(ou /cancelar para sair)_");
    return true;
  }

  // ── Aguardando placar da prorrogação (texto) ─────────────────────────────────
  if (data.step === "await_et_score") {
    const m = body.trim().match(SCORE_RE);
    if (!m) {
      await reply(
        "❌ Formato inválido. Ex: *2-1* ou *1x0*\n\n_(ou /cancelar para sair)_",
      );
      return true;
    }
    const etHome = parseInt(m[1], 10);
    const etAway = parseInt(m[2], 10);

    // Placar ET deve ser >= placar dos 90min para cada time
    if (etHome < data.predictedHome || etAway < data.predictedAway) {
      await reply(
        `❌ O placar da prorrogação deve ser maior ou igual ao dos 90min (*${data.predictedHome} x ${data.predictedAway}*).\n\n` +
        `Digite o placar *final* já incluindo os gols dos 90min.\n_(ou /cancelar para sair)_`,
      );
      return true;
    }

    const etIsDraw = etHome === etAway;

    if (etIsDraw) {
      // Prorrogação empatada → pênaltis, pergunta quem avança
      conversationState.startFlow(stateKey, "copa-palpite-input", {
        ...data,
        step: "await_advancing",
        predicted_extra_home: etHome,
        predicted_extra_away: etAway,
      });

      const options = [
        `${withFlag(data.homeTeam)} avança`,
        `${withFlag(data.awayTeam)} avança`,
      ];
      const pollMeta = {
        actionType: "menu",
        flowId: "copa-palpite",
        path: "/advancing",
        userId: stateKey,
        options: [
          { index: 0, label: options[0], action: "exec", handler: "setAdvancingTeam", data: { team: data.homeTeam, stateKey } },
          { index: 1, label: options[1], action: "exec", handler: "setAdvancingTeam", data: { team: data.awayTeam, stateKey } },
        ],
      };
      await polls.createPoll(client || { sendPoll: async () => null }, from || data.userId || stateKey,
        `⏱️ Prorrogação: *${etHome} x ${etAway}* — empate!\n\n🥅 ${matchup(data.homeTeam, data.awayTeam)}\nQuem avança nos pênaltis?`,
        options, { metadata: pollMeta });
      if (!client || !from) await reply("⚽ Vote na enquete acima.");
      return true;
    }

    // Prorrogação com vencedor → confirmação direta (sem enquete de pênaltis)
    const newData = {
      ...data,
      step: "await_confirmation",
      predicted_extra_home: etHome,
      predicted_extra_away: etAway,
      advancingTeam: null,
    };
    conversationState.startFlow(stateKey, "copa-palpite-input", newData);

    const kickoff = new Date(data.kickoffAt);
    const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
    const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

    const title =
      `🎯 Confirmar palpite?\n${matchup(data.homeTeam, data.awayTeam)}\n` +
      `*${data.predictedHome} x ${data.predictedAway}* · ${date} ${time}\n` +
      `⏱️ Prorrogação: *${etHome} x ${etAway}*`;
    const confirmOptions = ["✅ Confirmar", "✏️ Corrigir placar", "❌ Cancelar"];
    const pollMeta = {
      actionType: "menu",
      flowId: "copa-palpite",
      path: "/confirm",
      userId: stateKey,
      options: [
        {
          index: 0, label: "✅ Confirmar", action: "exec", handler: "confirmPrediction",
          data: { ...newData, userId: data.userId || stateKey },
        },
        {
          index: 1, label: "✏️ Corrigir placar", action: "exec", handler: "correctPrediction",
          data: { matchId: data.matchId, homeTeam: data.homeTeam, awayTeam: data.awayTeam, kickoffAt: data.kickoffAt, venue: data.venue, stage: data.stage, userId: data.userId || stateKey },
        },
        {
          index: 2, label: "❌ Cancelar", action: "exec", handler: "cancelPrediction",
          data: { userId: data.userId || stateKey },
        },
      ],
    };
    await polls.createPoll(client, from, title, confirmOptions, { metadata: pollMeta });
    return true;
  }

  // ── Aguardando confirmação (usuário deve votar na enquete) ───────────────────
  if (data.step === "await_confirmation") {
    await reply("🎯 Vote na enquete acima para confirmar, corrigir ou cancelar.\n_(ou /cancelar para sair)_");
    return true;
  }

  conversationState.clearState(stateKey);
  return false;
}

async function _submitPrediction(stateKey, data, reply) {
  try {
    const userId = data.userId || stateKey;
    await worldcupClient.submitPrediction(userId, data.matchId, data.predictedHome, data.predictedAway, data.advancingTeam || null, {
      predictedExtraHome: data.predicted_extra_home ?? null,
      predictedExtraAway: data.predicted_extra_away ?? null,
      penaltiesWinner:    data.penalties_winner ?? data.advancingTeam ?? null,
    });
    conversationState.clearState(stateKey);
    const wasAutoDisabled = dmAlertState.clearUser(userId);
    if (wasAutoDisabled) {
      worldcupClient.setDmAlerts(userId, true).catch(() => {});
    }

    const kickoff = new Date(data.kickoffAt);
    const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
    const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

    const homePt = localize(data.homeTeam).pt;
    const awayPt = localize(data.awayTeam).pt;

    const lines = [
      "✅ *Palpite salvo!*", "",
      `⚽ ${matchup(data.homeTeam, data.awayTeam)}`,
      `Placar: *${data.predictedHome} x ${data.predictedAway}*`,
      `📅 ${date} às ${time}`,
    ];
    if (data.venue) lines.push(`🏟 ${data.venue}`);
    if (data.predicted_extra_home != null && data.predicted_extra_away != null)
      lines.push(`⏱️ Prorrogação: *${data.predicted_extra_home} x ${data.predicted_extra_away}*`);
    if (data.penalties_winner)
      lines.push(`🥅 Pênaltis: *${withFlag(data.penalties_winner)} avança*`);
    else if (data.advancingTeam)
      lines.push(`🔮 Avança: *${withFlag(data.advancingTeam)}*`);
    lines.push(
      "",
      "Use */palpite* para fazer mais palpites ou editar este até o início do jogo.",
      "",
      "*Dica:* Para palpitar em outros jogos, basta clicar em outro confronto na enquete 🐶",
      "",
      `💡 *Atalho rápido:* */palpite ${homePt} ${data.predictedHome}x${data.predictedAway} ${awayPt}*`,
    );
    await reply(lines.join("\n"));
    logger.debug(`[copa-palpite] palpite salvo: ${userId.split("@")[0]} — ${data.homeTeam} ${data.predictedHome}x${data.predictedAway} ${data.awayTeam}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = e.message === "match_already_started"
      ? "❌ Este jogo já começou, palpites encerrados."
      : `❌ Erro ao salvar palpite: ${e.message}`;
    await reply(msg);
    logger.error("[copa-palpite] submitPrediction:", e.message);
  }
}

// ─── Champion handler ─────────────────────────────────────────────────────────

async function handleCopaChampionFlow(stateKey, body, state, reply, opts) {
  const data = state.data || {};
  const client = opts && opts.client;
  const from = opts && opts.from;

  if (data.step !== "await_champion_name") {
    conversationState.clearState(stateKey);
    return false;
  }

  const query = body.trim();
  if (!query) {
    await reply("❌ Digite o nome da seleção. _(ou /cancelar para sair)_");
    return true;
  }

  const matches = searchTeams(query, 5);

  if (!matches.length) {
    await reply(
      `❌ Nenhuma seleção encontrada para "*${query}*".\nTente outro nome. _(ou /cancelar)_`,
    );
    return true;
  }

  // Uma correspondência exata → salva direto
  if (matches.length === 1 || matches[0].score === 100) {
    await _saveChampion(stateKey, data.userId || stateKey, matches[0].pt, matches[0].flag, reply);
    return true;
  }

  // Múltiplos → mostra enquete
  const optionLabels = matches.map((m) => `${m.flag} ${m.pt}`);
  optionLabels.push("🔍 Buscar novamente");

  const optionsMeta = matches.map((m, i) => ({
    index: i,
    label: optionLabels[i],
    action: "exec",
    handler: "selectChampion",
    data: { team: m.pt, flag: m.flag, userId: data.userId || stateKey },
  }));
  optionsMeta.push({
    index: optionLabels.length - 1,
    label: "🔍 Buscar novamente",
    action: "exec",
    handler: "retryChampion",
    data: { userId: data.userId || stateKey },
  });

  if (client && from) {
    await polls.createPoll(client, from, "🏆 Qual seleção?", optionLabels, {
      metadata: {
        actionType: "menu",
        flowId: "copa-palpite",
        path: "/champion",
        userId: data.userId || stateKey,
        options: optionsMeta,
      },
    });
  } else {
    const lines = ["Selecione a seleção:"];
    matches.forEach((m, i) => lines.push(`*${i + 1}.* ${m.flag} ${m.pt}`));
    await reply(lines.join("\n"));
  }

  return true;
}

async function _saveChampion(stateKey, userId, team, flag, reply) {
  try {
    await worldcupClient.submitChampionPrediction(userId, team);
    conversationState.clearState(stateKey);
    await reply(`✅ *Palpite salvo!*\n\n🏆 Campeão: *${flag} ${team}*\n\nPode alterar até o início do mata-mata.`);
    logger.debug(`[copa-champion] ${userId.split("@")[0]} → ${team}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = (e.message === "knockout_started" || e.message === "group_stage_over")
      ? "❌ O mata-mata já começou. Não é mais possível alterar o palpite de campeão."
      : `❌ Erro ao salvar: ${e.message}`;
    await reply(msg);
  }
}

// ─── Zebra handler (idêntico ao champion mas com worldcupClient.submitZebra) ──

async function handleCopaZebraFlow(stateKey, body, state, reply, opts) {
  const data = state.data || {};
  const client = opts && opts.client;
  const from = opts && opts.from;

  if (data.step !== "await_zebra_name") { conversationState.clearState(stateKey); return false; }

  const query = body.trim();
  if (!query) { await reply("❌ Digite o nome da seleção. _(ou /cancelar)_"); return true; }

  const matches = searchTeams(query, 5);
  if (!matches.length) { await reply(`❌ Seleção não encontrada para "*${query}*". Tente outro nome.`); return true; }

  if (matches.length === 1 || matches[0].score === 100) {
    await _saveZebra(stateKey, data.userId || stateKey, matches[0].pt, matches[0].flag, reply);
    return true;
  }

  const optionLabels = matches.map((m) => `${m.flag} ${m.pt}`);
  optionLabels.push("🔍 Buscar novamente");
  const optionsMeta = matches.map((m, i) => ({
    index: i, label: optionLabels[i], action: "exec", handler: "selectZebra",
    data: { team: m.pt, flag: m.flag, userId: data.userId || stateKey },
  }));
  optionsMeta.push({ index: optionLabels.length - 1, label: "🔍 Buscar novamente", action: "exec", handler: "retryZebra", data: { userId: data.userId || stateKey } });

  if (client && from) {
    await polls.createPoll(client, from, "🦓 Qual a Zebra?", optionLabels, {
      metadata: { actionType: "menu", flowId: "copa-palpite", path: "/zebra", userId: data.userId || stateKey, options: optionsMeta },
    });
  } else {
    await reply(["Selecione:", ...matches.map((m, i) => `*${i + 1}.* ${m.flag} ${m.pt}`)].join("\n"));
  }
  return true;
}

async function _saveZebra(stateKey, userId, team, flag, reply) {
  try {
    await worldcupClient.submitZebraPrediction(userId, team);
    conversationState.clearState(stateKey);
    await reply(`✅ *Zebra salva!*\n\n🦓 Sua zebra: *${flag} ${team}*\n\nPode alterar até o início do mata-mata.`);
    logger.debug(`[copa-zebra] ${userId.split("@")[0]} → ${team}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = (e.message === "knockout_started" || e.message === "group_stage_over")
      ? "❌ O mata-mata já começou. Não é mais possível alterar o palpite de zebra."
      : `❌ Erro ao salvar: ${e.message}`;
    await reply(msg);
  }
}

// ─── MVP handler ──────────────────────────────────────────────────────────────

async function handleCopaMvpFlow(stateKey, body, state, reply) {
  const data = state.data || {};
  if (data.step !== "await_mvp_name") { conversationState.clearState(stateKey); return false; }

  const playerName = body.trim();
  if (!playerName || playerName.length < 2) {
    await reply("❌ Digite o nome do jogador. _(ou /cancelar)_");
    return true;
  }

  try {
    const userId = data.userId || stateKey;
    await worldcupClient.submitMvpPrediction(userId, playerName);
    conversationState.clearState(stateKey);
    await reply(`✅ *Craque salvo!*\n\n⭐ Seu craque: *${playerName}*\n\nPode alterar até o início do mata-mata.`);
    logger.debug(`[copa-mvp] ${userId.split("@")[0]} → ${playerName}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = (e.message === "knockout_started" || e.message === "group_stage_over")
      ? "❌ O mata-mata já começou. Não é mais possível alterar o palpite de craque."
      : `❌ Erro ao salvar: ${e.message}`;
    await reply(msg);
  }
  return true;
}

module.exports = { handleCopaFlow, handleCopaChampionFlow, handleCopaZebraFlow, handleCopaMvpFlow, _submitPrediction, _saveChampion, _saveZebra };
