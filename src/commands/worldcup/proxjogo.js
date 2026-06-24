"use strict";

const worldcupClient = require("../../services/worldcupClient");
const { withFlag, matchup } = require("../../utils/teamLocale");
const logger = require("../../utils/logger");

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

function formatDateLabel(kickoff) {
  const tz = "America/Sao_Paulo";
  const nowStr = new Date().toLocaleDateString("pt-BR", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const kickStr = kickoff.toLocaleDateString("pt-BR", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const [nowD, nowM, nowY] = nowStr.split("/").map(Number);
  const [kD, kM, kY] = kickStr.split("/").map(Number);
  const nowMid = Date.UTC(nowY, nowM - 1, nowD);
  const kMid   = Date.UTC(kY,  kM  - 1, kD);
  const diffDays = Math.round((kMid - nowMid) / 86400000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Amanhã";
  const weekday = kickoff.toLocaleDateString("pt-BR", { timeZone: tz, weekday: "long" });
  const date    = kickoff.toLocaleDateString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" });
  return `${weekday}, ${date}`;
}

function formatMatch(m, index) {
  const kickoff = new Date(m.kickoff_at);
  const time  = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const label = formatDateLabel(kickoff);
  const stage = m.group_name ? `Grupo ${m.group_name.replace("GROUP_", "").replace("Group ", "")}` : formatStage(m.stage);
  const venue = m.venue || "";
  const meta  = [stage, venue].filter(Boolean).join(" · ");
  const palpites = m.predictionCount > 0 ? ` · 🎯 ${m.predictionCount} palpite${m.predictionCount !== 1 ? "s" : ""}` : "";

  if (m.status === "live") {
    const score = m.home_score != null ? `${m.home_score} x ${m.away_score}` : "0 x 0";
    return [`🔴 *${withFlag(m.home_team)} ${score} ${withFlag(m.away_team)}* — AO VIVO`, `🏟️ ${meta}${palpites}`].join("\n");
  }

  return [
    `*${index + 1}.* ${matchup(m.home_team, m.away_team)}`,
    `📅 ${label} às ${time}`,
    `🏟️ ${meta}${palpites}`,
  ].join("\n");
}

module.exports = {
  name: "proxjogo",
  aliases: ["proxjogos", "proximojogo", "proximosjogos", "nextmatch", "nextmatches", "jogos"],
  description: "Mostra os próximos 5 jogos da Copa do Mundo",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;

    try {
      const { matches } = await worldcupClient.getNextMatches(5);

      if (!matches || !matches.length) {
        await client.sendMessage(chatId, "⚽ Nenhum jogo agendado encontrado.");
        return;
      }

      const lines = ["⚽ *Próximos 5 jogos — Copa do Mundo 2026*", ""];
      for (let i = 0; i < matches.length; i++) {
        if (i > 0) lines.push("");
        lines.push(formatMatch(matches[i], i));
      }

      await client.sendMessage(chatId, lines.join("\n"));
    } catch (e) {
      logger.error("[proxjogo]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar os 5 próximos jogos.");
    }
  },
};
