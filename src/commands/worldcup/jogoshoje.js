"use strict";

const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

function formatMatch(m) {
  const kickoff = new Date(m.kickoff_at);
  const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const stage = m.group_name ? `Grupo ${m.group_name.replace("Group ", "")}` : "";

  if (m.status === "live") {
    const score = m.home_score != null ? `${m.home_score} x ${m.away_score}` : "0 x 0";
    return `🔴 ${m.home_team} *${score}* ${m.away_team} — AO VIVO${stage ? ` (${stage})` : ""}`;
  }
  if (m.status === "finished") {
    return `✅ ${m.home_team} ${m.home_score} x ${m.away_score} ${m.away_team}${stage ? ` (${stage})` : ""}`;
  }
  return `⏰ ${time} — ${m.home_team} 🆚 ${m.away_team}${stage ? ` (${stage})` : ""}`;
}

module.exports = {
  name: "jogoshoje",
  aliases: ["jogohj", "jogoshj"],
  description: "Lista os jogos da Copa do Mundo de hoje",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;

    try {
      const { matches } = await worldcupClient.getMatchesToday();

      if (!matches || !matches.length) {
        await client.sendMessage(chatId, "⚽ Nenhum jogo hoje.");
        return;
      }

      const today = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit" });
      const lines = [`⚽ *Jogos de hoje — ${today}*`, ""];
      for (const m of matches) lines.push(formatMatch(m));

      await client.sendMessage(chatId, lines.join("\n"));
    } catch (e) {
      logger.error("[jogoshoje]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar os jogos de hoje.");
    }
  },
};
