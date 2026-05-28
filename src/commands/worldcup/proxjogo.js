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

function formatMatch(m, index) {
  const kickoff = new Date(m.kickoff_at);
  const weekday = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" });
  const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const stage = m.group_name ? `Grupo ${m.group_name.replace("GROUP_", "").replace("Group ", "")}` : formatStage(m.stage);
  const venue = m.venue ? `📍 ${m.venue}` : "";

  if (m.status === "live") {
    const score = m.home_score != null ? `${m.home_score} x ${m.away_score}` : "0 x 0";
    return [`🔴 *${withFlag(m.home_team)} ${score} ${withFlag(m.away_team)}* — AO VIVO`, `📍 ${stage}${venue ? ` · ${m.venue}` : ""}`].join("\n");
  }

  const lines = [
    `*${index + 1}.* ${matchup(m.home_team, m.away_team)}`,
    `📅 ${weekday}, ${date} às ${time}`,
    `🏟 ${stage}${venue ? ` · ${m.venue}` : ""}`,
  ];
  return lines.join("\n");
}

module.exports = {
  name: "proxjogo",
  aliases: [],
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

      const lines = ["⚽ *Próximos jogos — Copa do Mundo 2026*", ""];
      for (let i = 0; i < matches.length; i++) {
        if (i > 0) lines.push("");
        lines.push(formatMatch(matches[i], i));
      }

      await client.sendMessage(chatId, lines.join("\n"));
    } catch (e) {
      logger.error("[proxjogo]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar os próximos jogos.");
    }
  },
};
