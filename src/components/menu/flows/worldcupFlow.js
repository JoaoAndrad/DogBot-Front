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

function formatStage(stage) {
  const map = {
    group: "Fase de Grupos",
    round_of_32: "16 avos de final",
    round_of_16: "Oitavas de final",
    quarter_final: "Quartas de Final",
    semi_final: "Semifinal",
    third_place: "3º Lugar",
    final: "Final",
  };
  return map[stage] || stage;
}

// ─── Flow ─────────────────────────────────────────────────────────────────────

const worldcupFlow = createFlow("copa", {
  root: {
    title: "⚽ *Copa do Mundo*",
    options: [
      { label: "📅 Próximos jogos (5)", action: "exec", handler: "showNextMatches" },
      { label: "📊 Tabela", action: "goto", target: "/tabela" },
      { label: "🏆 Ranking do grupo", action: "exec", handler: "showLeaderboard" },
      { label: "📋 Meus palpites", action: "exec", handler: "showMyPredictions" },
      { label: "❓ Dúvidas", action: "goto", target: "/duvidas" },
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

  "/duvidas": {
    title: "❓ *Dúvidas — Copa 2026*",
    options: [
      { label: "🔒 Privacidade dos palpites",    action: "exec", handler: "faqPrivacidade" },
      { label: "🏅 Pontuação",                   action: "exec", handler: "faqPontuacao" },
      { label: "⏰ Prazos para palpitar",        action: "exec", handler: "faqPrazos" },
      { label: "📋 Comandos disponíveis",        action: "exec", handler: "faqComandos" },
      { label: "🔔 Notificações do grupo",       action: "exec", handler: "faqNotificacoes" },
      { label: "🎲 Bolão",                       action: "exec", handler: "faqBolao" },
      { label: "🔙 Voltar",                      action: "back" },
    ],
  },

  handlers: {
    // ── FAQ ──────────────────────────────────────────────────────────────────
    faqPrivacidade: async (ctx) => {
      await ctx.reply([
        "🔒 *Privacidade dos palpites*",
        "",
        "Seus palpites são *completamente privados* — apenas você tem acesso aos seus votos.",
        "",
        "Isso evita que outros usuários influenciem suas escolhas antes das partidas.",
        "",
        "Assim que o jogo começar e os palpites forem travados, o grupo verá o resultado de todos junto com as notificações de gol e placar final.",
        "",
        "🎯 Use */palpite* no privado para apostar.",
      ].join("\n"));
      return { noRender: true };
    },

    faqPontuacao: async (ctx) => {
      await ctx.reply([
        "🏅 *Sistema de Pontuação*",
        "",
        "🟢 *Fase de grupos*",
        "• Placar exato → *3 pts*",
        "• Resultado certo (placar errado) → *1 pt*",
        "• Errou → 0 pts",
        "",
        "⚔️ *Mata-mata (16 avos em diante)*",
        "_(Palpites disponíveis após o fim da fase de grupos)_",
        "",
        "📋 *Como funciona o palpite:*",
        "1️⃣ Você palpita o placar dos 90min normalmente",
        "2️⃣ Se palpitar empate, será perguntado se quer palpitar a prorrogação _(opcional, +1 pt se acertar o placar exato)_",
        "3️⃣ Uma enquete pergunta quem avança (+1 pt se acertar)",
        "",
        "🏅 *Pontuação:*",
        "• Placar exato nos 90min → *3 pts*",
        "• Resultado certo nos 90min → *1 pt*",
        "• ➕ Acertar quem avança (em empate) → *+1 pt*",
        "• ➕ Placar exato na prorrogação → *+1 pt*",
        "",
        "🥇 Máximo possível: *5 pts* por jogo",
        "",
        "🏆 *Campeão da Copa* → *20 pts*",
        "🦓 *Zebra da Copa* → *10 pts*",
        "⭐ *Craque da Copa* → *8 pts*",
      ].join("\n"));
      return { noRender: true };
    },

    faqPrazos: async (ctx) => {
      await ctx.reply([
        "⏰ *Prazos para palpitar*",
        "",
        "⚽ *Fase de grupos*",
        "Disponível até o apito inicial de cada jogo.",
        "Após o início, os palpites são travados automaticamente.",
        "",
        "⚔️ *Fase eliminatória (oitavas em diante)*",
        "Os palpites ficam disponíveis apenas *após o término da fase de grupos*.",
        "A cada rodada, o prazo encerra ao apito inicial do respectivo jogo.",
        "",
        "🏆 *Campeão · 🦓 Zebra · ⭐ Craque*",
        "Disponíveis apenas antes ou durante a *fase de grupos*.",
        "Encerram automaticamente quando a última partida da fase de grupos começar.",
        "",
        "_Aproveite para votar logo, depois não dá mais!_",
      ].join("\n"));
      return { noRender: true };
    },

    faqComandos: async (ctx) => {
      await ctx.reply([
        "📋 *Comandos disponíveis*",
        "",
        "*/copa* — Abre este menu",
        "*/proxjogo* — Próximos 5 jogos",
        "*/jogoshoje* — Jogos do dia",
        "*/tabela grupo A* — Classificação (substitua A pela letra)",
        "*/placar* — Ranking de palpites do grupo",
        "*/palpite* — Fazer palpites _(no privado)_",
      ].join("\n"));
      return { noRender: true };
    },

    faqNotificacoes: async (ctx) => {
      await ctx.reply([
        "🔔 *Notificações do grupo*",
        "",
        "O grupo recebe automaticamente:",
        "",
        "⏰ *Lembrete 24h antes* do jogo",
        "⏰ *Lembrete 1h antes* + aviso de último chamado para palpites",
        "⚽ *Gol em tempo real* com nome do marcador",
        "⏸ *Intervalo* com placar e status dos palpites",
        "✅ *Resultado final* com pontuação dos palpiteiros",
        "📊 *Resumo semanal* toda segunda-feira às 8h",
        "",
        "Para ativar/desativar notificações específicas, use ⚙️ Configurações.",
      ].join("\n"));
      return { noRender: true };
    },

    faqBolao: async (ctx) => {
      await ctx.reply([
        "🎲 *Bolão da Copa*",
        "",
        "O bolão é uma competição *dentro deste grupo*, separada do ranking geral.",
        "",
        "Quando um admin ativa o */bolao*, todos os participantes entram com a pontuação zerada — independente dos pontos que já tinham antes. Só contam os pontos conquistados *a partir daquele momento*.",
        "",
        "Isso niveala o jogo: quem entrou tarde no bolão de palpites tem a mesma chance de vencer que quem está desde o início.",
        "",
        "💰 *Sobre o prêmio:*",
        "Uma parte do valor arrecadado cobre a assinatura da API que usamos para detectar gols e eventos em tempo real. O restante vai *inteiro para o vencedor do bolão* 🏆",
        "",
        "Use */placar* para ver o ranking atual do bolão.",
      ].join("\n"));
      return { noRender: true };
    },

    showNextMatches: async (ctx) => {
      try {
        const { matches } = await worldcupClient.getNextMatches(5);
        if (!matches || !matches.length) {
          await ctx.reply("⚽ Nenhum jogo agendado.");
          return { noRender: true };
        }
        const lines = ["⚽ *Próximos 5 jogos*", ""];
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          const kickoff = new Date(m.kickoff_at);
          const weekday = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short" });
          const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
          const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
          const stage = m.group_name ? `Grupo ${m.group_name.replace("GROUP_", "").replace("Group ", "")}` : formatStage(m.stage);
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
        const chat = ctx.client?.getChatById
          ? await ctx.client.getChatById(ctx.chatId)
          : await ctx.message.getChat();
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
          const name = e.pushName || e.displayName || (e.senderNumber ? e.senderNumber.split("@")[0] : "?");
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
          `⚽ Gols: ${settings.goal_notifications ? "✅" : "❌"}`,
          `🟨 Cartões: ${settings.card_notifications ? "✅" : "❌"}`,
          `🔄 Substituições: ${settings.substitution_notifications ? "✅" : "❌"}`,
          `📊 Resumo semanal: ${settings.weekly_summary ? "✅" : "❌"}`,
          `🎯 Bolão: ${settings.bolao_notifications ? "✅" : "❌"}`,
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
        stage: m.stage || "group",
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
  if (prediction.points === 3) return "✅";
  if (prediction.points === 1) return "🔸";
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
    return `${icon} ${withFlag(m.home_team)} x ${withFlag(m.away_team)} · ${realScore} — meu: ${myScore}`.slice(0, 100);
  }
  return `${icon} ${withFlag(m.home_team)} x ${withFlag(m.away_team)} · ${date} ${time} — ${myScore}`.slice(0, 100);
}

// ─── Prediction flow ──────────────────────────────────────────────────────────

const worldcupPalpiteFlow = createFlow("copa-palpite", {
  root: {
    title: "🎯 *Palpites — Copa do Mundo*",
    options: [
      { label: "📋 Meus palpites",    action: "exec", handler: "showMyPredictions" },
      { label: "🎯 Novo palpite",     action: "exec", handler: "showNewPalpite" },
      { label: "❌ Sair",             action: "exec", handler: "leave" },
    ],
  },

  handlers: {
    // ── Campeão da Copa ────────────────────────────────────────────────────
    showChampionMenu: async (ctx) => {
      const { localize } = require("../../../utils/teamLocale");
      let current = null;
      try {
        const r = await worldcupClient.getChampionPrediction(ctx.userId);
        current = r && r.prediction ? r.prediction : null;
      } catch (e) { /* sem palpite ainda */ }

      const lines = ["🏆 *Campeão da Copa 2026*", ""];
      if (current) {
        const { pt, flag } = localize(current.team);
        lines.push(`Seu palpite atual: *${flag} ${pt}*`);
        if (current.points != null) {
          lines.push(current.points === 20 ? "🎉 Acertou! +20 pts" : "❌ Não acertou");
        } else {
          lines.push("_(pode alterar até o fim da fase de grupos)_");
        }
      } else {
        lines.push("Você ainda não votou no campeão!");
        lines.push("_(disponível até o fim da fase de grupos)_");
      }

      await ctx.reply(lines.join("\n"));

      // Inicia input via conversationState
      conversationState.startFlow(ctx.userId, "copa-champion-input", {
        step: "await_champion_name",
        userId: ctx.userId,
      });
      await ctx.reply(
        current
          ? "Digite o nome da nova seleção para alterar o palpite:\n_(ou /cancelar para sair)_"
          : "Digite o nome da seleção campeã:\n_(ou /cancelar para sair)_",
      );
      return { end: true };
    },

    selectChampion: async (ctx, data) => {
      const { _saveChampion } = require("../../../handlers/copaFlowHandler");
      const userId = data.userId || ctx.userId;
      await _saveChampion(userId, userId, data.team, data.flag || "", (msg) => ctx.reply(msg));
      conversationState.clearState(userId);
      return { end: true };
    },

    retryChampion: async (ctx, data) => {
      const userId = data.userId || ctx.userId;
      conversationState.startFlow(userId, "copa-champion-input", {
        step: "await_champion_name",
        userId,
      });
      await ctx.reply("Digite novamente o nome da seleção:\n_(ou /cancelar para sair)_");
      return { end: true };
    },

    // ── Meus palpites ───────────────────────────────────────────────────────
    showMyPredictions: async (ctx) => {
      let predictions;
      let championPrediction = null;
      let zebraPrediction = null;
      let mvpPrediction = null;
      try {
        [
          { predictions },
          { prediction: championPrediction },
          { prediction: zebraPrediction },
          { prediction: mvpPrediction },
        ] = await Promise.all([
          worldcupClient.getUserPredictions(ctx.userId),
          worldcupClient.getChampionPrediction(ctx.userId),
          worldcupClient.getZebraPrediction(ctx.userId),
          worldcupClient.getMvpPrediction(ctx.userId),
        ]);
      } catch (e) {
        logger.error("[worldcupFlow] showMyPredictions:", e.message);
        await ctx.reply("❌ Erro ao buscar palpites.");
        return { end: true };
      }

      const matchPreds = predictions || [];
      const hasAny = matchPreds.length || championPrediction || zebraPrediction || mvpPrediction;
      if (!hasAny) {
        await ctx.reply(
          "📋 *Meus palpites*\n\nVocê ainda não realizou nenhum palpite.\nUse *Novo palpite* para começar! 🎯",
        );
        return { end: true };
      }

      const futurePreds = matchPreds.filter(p => p.match && p.match.status !== "finished");
      const pastPreds   = matchPreds.filter(p => p.match && p.match.status === "finished");

      const futureTournament = [championPrediction, zebraPrediction, mvpPrediction].filter(p => p && p.points == null);
      const pastTournament   = [championPrediction, zebraPrediction, mvpPrediction].filter(p => p && p.points != null);

      const futureCount = futurePreds.length + futureTournament.length;
      const pastCount   = pastPreds.length   + pastTournament.length;

      const optionLabels = [];
      const optionsMeta  = [];

      if (futureCount > 0) {
        const label = `📅 Palpites futuros (${futureCount})`;
        optionLabels.push(label);
        optionsMeta.push({ index: optionLabels.length - 1, label, action: "exec", handler: "showPredictionsByType", data: { type: "future", page: 0 } });
      }
      if (pastCount > 0) {
        const label = `📆 Palpites passados (${pastCount})`;
        optionLabels.push(label);
        optionsMeta.push({ index: optionLabels.length - 1, label, action: "exec", handler: "showPredictionsByType", data: { type: "past", page: 0 } });
      }

      // WhatsApp exige mínimo 2 opções na enquete
      if (optionLabels.length < 2) {
        optionLabels.push("🔙 Voltar");
        optionsMeta.push({ index: optionLabels.length - 1, label: "🔙 Voltar", action: "exec", handler: "backToRoot", data: {} });
      } else {
        optionLabels.push("🔙 Voltar");
        optionsMeta.push({ index: optionLabels.length - 1, label: "🔙 Voltar", action: "exec", handler: "backToRoot", data: {} });
      }

      await polls.createPoll(ctx.client, ctx.chatId, "📋 Meus palpites", optionLabels, {
        metadata: { actionType: "menu", flowId: "copa-palpite", path: "/my", userId: ctx.userId, options: optionsMeta },
      });
      return { end: true };
    },

    showPredictionsByType: async (ctx, data = {}) => {
      // PAGE_SIZE=7: WhatsApp limit is 12 options.
      // Worst case: 3 tournament + 7 match + 1 next + 1 back = 12 exactly.
      const PAGE_SIZE = 7;
      const type = (data && data.type) || "future";
      const page = (data && data.page) || 0;
      const { localize } = require("../../../utils/teamLocale");

      let predictions;
      let championPrediction = null;
      let zebraPrediction = null;
      let mvpPrediction = null;
      try {
        [
          { predictions },
          { prediction: championPrediction },
          { prediction: zebraPrediction },
          { prediction: mvpPrediction },
        ] = await Promise.all([
          worldcupClient.getUserPredictions(ctx.userId),
          worldcupClient.getChampionPrediction(ctx.userId),
          worldcupClient.getZebraPrediction(ctx.userId),
          worldcupClient.getMvpPrediction(ctx.userId),
        ]);
      } catch (e) {
        logger.error("[worldcupFlow] showPredictionsByType:", e.message);
        await ctx.reply("❌ Erro ao buscar palpites.");
        return { end: true };
      }

      const allMatch = predictions || [];
      const isFuture = type === "future";

      // Filtra partidas pelo tipo e ordena crescente por data do jogo
      const matchItems = allMatch
        .filter(p => {
          if (!p.match) return false;
          const s = p.match.status;
          return isFuture ? p.match.status !== "finished" : p.match.status === "finished";
        })
        .sort((a, b) => new Date(a.match.kickoff_at) - new Date(b.match.kickoff_at));

      // Palpites de torneio para este tipo
      const tournamentItems = [];
      if (championPrediction) {
        const resolved = championPrediction.points != null;
        if ((isFuture && !resolved) || (!isFuture && resolved)) tournamentItems.push({ kind: "champion", p: championPrediction });
      }
      if (zebraPrediction) {
        const resolved = zebraPrediction.points != null;
        if ((isFuture && !resolved) || (!isFuture && resolved)) tournamentItems.push({ kind: "zebra", p: zebraPrediction });
      }
      if (mvpPrediction) {
        const resolved = mvpPrediction.points != null;
        if ((isFuture && !resolved) || (!isFuture && resolved)) tournamentItems.push({ kind: "mvp", p: mvpPrediction });
      }

      const totalMatchPages = Math.max(1, Math.ceil(matchItems.length / PAGE_SIZE));

      // Torneio só na primeira página; partidas paginadas
      const safePage = Math.min(page, totalMatchPages - 1);
      const pageMatchItems = matchItems.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

      const optionLabels = [];
      const optionsMeta  = [];

      // Torneio (sem data) aparece no topo da primeira página
      if (safePage === 0) {
        for (const { kind, p } of tournamentItems) {
          let label;
          if (kind === "champion") {
            const { pt, flag } = localize(p.team);
            const pts = p.points != null ? ` — ${p.points === 20 ? "🎉 +20 pts" : "❌ 0 pts"}` : " — aguardando";
            label = `🏆 Campeão: ${flag} ${pt}${pts}`.slice(0, 100);
            optionLabels.push(label);
            optionsMeta.push({ index: optionLabels.length - 1, label, action: "exec", handler: "showChampionMenu", data: {} });
          } else if (kind === "zebra") {
            const { pt, flag } = localize(p.team);
            const pts = p.points != null ? ` — ${p.points > 0 ? `🎉 +${p.points} pts` : "❌ 0 pts"}` : "";
            label = `🦓 Zebra: ${flag} ${pt}${pts}`.slice(0, 100);
            optionLabels.push(label);
            optionsMeta.push({ index: optionLabels.length - 1, label, action: "exec", handler: "startZebraInput", data: {} });
          } else if (kind === "mvp") {
            const pts = p.points != null ? ` — ${p.points > 0 ? `🎉 +${p.points} pts` : "❌ 0 pts"}` : "";
            const mvpName = p.player_name && /messi/i.test(p.player_name) ? `${p.player_name} 🐐` : p.player_name && /cristiano\s+ronaldo|c\.?\s*ronaldo/i.test(p.player_name) ? `${p.player_name} 💩` : p.player_name;
            label = `⭐ Craque: ${mvpName}${pts}`.slice(0, 100);
            optionLabels.push(label);
            optionsMeta.push({ index: optionLabels.length - 1, label, action: "exec", handler: "startMvpInput", data: {} });
          }
        }
      }

      // Partidas desta página
      for (const p of pageMatchItems) {
        const m = p.match;
        const label = predictionLabel(p);
        optionLabels.push(label);
        const isEditable = m.status === "scheduled";
        optionsMeta.push({
          index: optionLabels.length - 1,
          label,
          action: "exec",
          handler: isEditable ? "selectMatch" : "showPredictionDetail",
          data: isEditable
            ? { matchId: m.id, homeTeam: m.home_team, awayTeam: m.away_team, kickoffAt: m.kickoff_at, venue: m.venue }
            : { homeTeam: m.home_team, awayTeam: m.away_team, finalHome: m.home_score, finalAway: m.away_score, predictedHome: p.predicted_home, predictedAway: p.predicted_away, points: p.points, status: m.status },
        });
      }

      // Navegação de páginas (carrega tipo junto)
      if (safePage > 0) {
        const label = "◀️ Página anterior";
        optionLabels.push(label);
        optionsMeta.push({ index: optionLabels.length - 1, label, action: "exec", handler: "showPredictionsByType", data: { type, page: safePage - 1 } });
      }
      if (safePage < totalMatchPages - 1) {
        const label = `▶️ Próxima página (${safePage + 1}/${totalMatchPages})`;
        optionLabels.push(label);
        optionsMeta.push({ index: optionLabels.length - 1, label, action: "exec", handler: "showPredictionsByType", data: { type, page: safePage + 1 } });
      }

      optionLabels.push("🔙 Voltar");
      optionsMeta.push({ index: optionLabels.length - 1, label: "🔙 Voltar", action: "exec", handler: "showMyPredictions", data: {} });

      const typeLabel = isFuture ? "📅 Palpites futuros" : "📆 Palpites passados";
      const title = totalMatchPages > 1
        ? `${typeLabel} (${safePage + 1}/${totalMatchPages})`
        : typeLabel;

      // Garante mínimo de 2 opções (exigência do WhatsApp)
      if (optionLabels.length < 2) {
        await ctx.reply("Nenhum palpite encontrado para esta categoria.");
        return { end: true };
      }

      await polls.createPoll(ctx.client, ctx.chatId, title, optionLabels, {
        metadata: { actionType: "menu", flowId: "copa-palpite", path: "/my-type", userId: ctx.userId, options: optionsMeta },
      });
      return { end: true };
    },

    showMyPredictionsPage: async (ctx, data) => {
      return worldcupPalpiteFlow.handlers.showPredictionsByType(ctx, data);
    },

    showPredictionDetail: async (ctx, data) => {
      const { homeTeam, awayTeam, finalHome, finalAway, predictedHome, predictedAway, points, status } = data;
      const realScore = finalHome != null ? `${finalHome} x ${finalAway}` : "a definir";
      const myScore = `${predictedHome} x ${predictedAway}`;

      const ptLabel = points === 3 ? "✅ Placar exato — 3 pts"
        : points === 1 ? "🔸 Vencedor certo — 1 pt"
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

    // ── Novo palpite — submenu ────────────────────────────────────────────────
    showNewPalpite: async (ctx) => {
      const options = ["🏆 Campeão da Copa", "⚽ Placar da Partida", "🦓 Zebra da Copa", "⭐ Craque da Copa", "🔙 Voltar"];
      const meta = [
        { index: 0, label: options[0], action: "exec", handler: "startChampionInput", data: {} },
        { index: 1, label: options[1], action: "exec", handler: "startMatchPick",     data: {} },
        { index: 2, label: options[2], action: "exec", handler: "startZebraInput",    data: {} },
        { index: 3, label: options[3], action: "exec", handler: "startMvpInput",      data: {} },
        { index: 4, label: options[4], action: "exec", handler: "backToRoot",         data: {} },
      ];
      await polls.createPoll(ctx.client, ctx.chatId, "🎯 O que quer palpitar?", options, {
        metadata: { actionType: "menu", flowId: "copa-palpite", path: "/novo", userId: ctx.userId, options: meta },
      });
      return { end: true };
    },

    startMatchPick:  async (ctx) => showMatchPage(ctx, { page: 0 }),
    showMatchPage:   async (ctx, data) => showMatchPage(ctx, data),

    // ── Campeão / Zebra / MVP input launchers ────────────────────────────────
    startChampionInput: async (ctx) => {
      conversationState.startFlow(ctx.userId, "copa-champion-input", {
        step: "await_champion_name", userId: ctx.userId,
      });
      await ctx.reply("🏆 *Campeão da Copa*\n\nDigite o nome da seleção:\n_(ou /cancelar para sair)_");
      return { end: true };
    },

    startZebraInput: async (ctx) => {
      conversationState.startFlow(ctx.userId, "copa-zebra-input", {
        step: "await_zebra_name", userId: ctx.userId,
      });
      await ctx.reply("🦓 *Zebra da Copa*\n\nDigite o nome da seleção que vai surpreender:\n_(ou /cancelar para sair)_");
      return { end: true };
    },

    startMvpInput: async (ctx) => {
      conversationState.startFlow(ctx.userId, "copa-mvp-input", {
        step: "await_mvp_name", userId: ctx.userId,
      });
      await ctx.reply("⭐ *Craque da Copa*\n\nDigite o nome do jogador que você acha que será o craque:\n_(ou /cancelar para sair)_");
      return { end: true };
    },

    // ── Zebra poll callbacks ──────────────────────────────────────────────────
    selectZebra: async (ctx, data) => {
      const { _saveZebra } = require("../../../handlers/copaFlowHandler");
      const userId = data.userId || ctx.userId;
      await _saveZebra(userId, userId, data.team, data.flag || "", (msg) => ctx.reply(msg));
      conversationState.clearState(userId);
      return { end: true };
    },

    retryZebra: async (ctx, data) => {
      const userId = data.userId || ctx.userId;
      conversationState.startFlow(userId, "copa-zebra-input", {
        step: "await_zebra_name", userId,
      });
      await ctx.reply("Digite novamente o nome da seleção:\n_(ou /cancelar para sair)_");
      return { end: true };
    },

    // ── ET prediction poll callbacks ─────────────────────────────────────────
    acceptEtPrediction: async (ctx, data) => {
      const stateKey = data.stateKey || ctx.userId;
      const current = conversationState.getState(stateKey);
      if (!current || !current.data) { await ctx.reply("❌ Sessão expirada. Use /palpite novamente."); return { end: true }; }
      const matchData = current.data;
      conversationState.startFlow(stateKey, "copa-palpite-input", {
        ...matchData,
        step: "await_et_score",
      });
      await ctx.reply(
        `⏱️ *Placar da prorrogação — ${matchup(matchData.homeTeam, matchData.awayTeam)}*\n\n` +
        `Digite o placar no formato *H-A* (apenas gols na prorrogação, sem os dos 90min)\n` +
        `Ex: se você acha que o 2º tempo extra termina *2-1*, escreva *2-1*\n\n` +
        `_(ou /cancelar para sair)_`,
      );
      return { end: true };
    },

    skipEtPrediction: async (ctx, data) => {
      const stateKey = data.stateKey || ctx.userId;
      const current = conversationState.getState(stateKey);
      if (!current || !current.data) { await ctx.reply("❌ Sessão expirada. Use /palpite novamente."); return { end: true }; }
      const matchData = current.data;
      conversationState.startFlow(stateKey, "copa-palpite-input", {
        ...matchData,
        step: "await_advancing",
      });
      const options = [
        `${withFlag(matchData.homeTeam)} ${matchData.homeTeam} avança`,
        `${withFlag(matchData.awayTeam)} ${matchData.awayTeam} avança`,
      ];
      const pollMeta = {
        actionType: "menu", flowId: "copa-palpite", path: "/advancing", userId: stateKey,
        options: [
          { index: 0, label: options[0], action: "exec", handler: "setAdvancingTeam", data: { team: matchData.homeTeam, stateKey } },
          { index: 1, label: options[1], action: "exec", handler: "setAdvancingTeam", data: { team: matchData.awayTeam, stateKey } },
        ],
      };
      await polls.createPoll(ctx.client, ctx.chatId,
        `🔮 Empate! ${matchup(matchData.homeTeam, matchData.awayTeam)}\nQuem avança?`,
        options, { metadata: pollMeta });
      return { end: true };
    },

    // ── Advancing team poll callback ──────────────────────────────────────────
    setAdvancingTeam: async (ctx, data) => {
      const stateKey = data.stateKey || ctx.userId;
      const current = conversationState.getState(stateKey);
      if (!current || !current.data) { await ctx.reply("❌ Sessão expirada. Use /palpite novamente."); return { end: true }; }
      const matchData = current.data;
      conversationState.startFlow(stateKey, "copa-palpite-input", {
        ...matchData,
        step: "await_confirmation",
        advancingTeam: data.team,
      });
      const kickoff = new Date(matchData.kickoffAt);
      const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
      const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      const etLine = matchData.predicted_extra_home != null
        ? `\n⏱️ Prorrogação: *${matchData.predicted_extra_home} x ${matchData.predicted_extra_away}*`
        : "";
      const title =
        `🎯 Confirmar palpite?\n${matchup(matchData.homeTeam, matchData.awayTeam)}\n` +
        `*${matchData.predictedHome} x ${matchData.predictedAway}* · ${date} ${time}${etLine}\n` +
        `🔮 Avança: *${withFlag(data.team)}*`;
      const options = ["✅ Confirmar", "✏️ Corrigir placar", "❌ Cancelar"];
      const pollMeta = {
        actionType: "menu", flowId: "copa-palpite", path: "/confirm", userId: stateKey,
        options: [
          { index: 0, label: "✅ Confirmar",     action: "exec", handler: "confirmPrediction",
            data: { ...matchData, predictedHome: matchData.predictedHome, predictedAway: matchData.predictedAway, advancingTeam: data.team, userId: stateKey } },
          { index: 1, label: "✏️ Corrigir placar", action: "exec", handler: "correctPrediction",
            data: { matchId: matchData.matchId, homeTeam: matchData.homeTeam, awayTeam: matchData.awayTeam, kickoffAt: matchData.kickoffAt, venue: matchData.venue, stage: matchData.stage, userId: stateKey } },
          { index: 2, label: "❌ Cancelar", action: "exec", handler: "cancelPrediction", data: { userId: stateKey } },
        ],
      };
      await polls.createPoll(ctx.client, ctx.chatId, title, options, { metadata: pollMeta });
      return { end: true };
    },

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
        stage: data.stage || "group",
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
