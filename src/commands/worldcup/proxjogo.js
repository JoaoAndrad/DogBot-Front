"use strict";

const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

function formatMatch(m) {
  const kickoff = new Date(m.kickoff_at);
  const date = kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit" });
  const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const stage = m.group_name ? `Grupo ${m.group_name.replace("Group ", "")}` : formatStage(m.stage);

  if (m.status === "live") {
    const score = m.home_score != null ? `${m.home_score} x ${m.away_score}` : "0 x 0";
    return `🔴 *AO VIVO* — ${m.home_team} ${score} ${m.away_team}\n📍 ${stage}`;
  }

  return `⚽ *Próximo jogo*\n${m.home_team} 🆚 ${m.away_team}\n📅 ${date} às ${time}\n📍 ${stage}`;
}

function formatStage(stage) {
  const map = {
    group: "Fase de Grupos",
    round_of_16: "Oitavas de Final",
    quarter_final: "Quartas de Final",
    semi_final: "Semifinal",
    third_place: "3º Lugar",
    final: "Final",
  };
  return map[stage] || stage;
}

module.exports = {
  name: "proxjogo",
  aliases: [],
  description: "Mostra o próximo jogo da Copa do Mundo",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;

    try {
      const { match } = await worldcupClient.getNextMatch();

      if (!match) {
        await client.sendMessage(chatId, "⚽ Nenhum jogo agendado encontrado.");
        return;
      }

      await client.sendMessage(chatId, formatMatch(match));
    } catch (e) {
      logger.error("[proxjogo]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar o próximo jogo.");
    }
  },
};
