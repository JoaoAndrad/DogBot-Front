"use strict";

const worldcupClient = require("../../services/worldcupClient");
const { withFlag, localize } = require("../../utils/teamLocale");
const logger = require("../../utils/logger");

const goat = (n) => {
  if (!n) return n;
  if (/messi/i.test(n)) return `${n} 🐐`;
  if (/cristiano\s+ronaldo|c\.?\s*ronaldo/i.test(n)) return `${n} 💩`;
  return n;
};

function formatGoals(goals) {
  if (!goals || !goals.length) return "";
  return goals
    .map((g) => {
      const min = g.minute != null ? `${g.minute}' ` : "";
      const name = goat(g.scorer) || "";
      const flag = g.team ? (localize(g.team).flag || "") : "";
      return `   ⚽ ${min}${name}${flag ? ` ${flag}` : ""}`.trimEnd();
    })
    .join("\n");
}

function formatMeta(m) {
  const groupLetter = m.group_name ? m.group_name.replace(/^GROUP_?/i, "").replace(/^Group\s*/i, "").trim() : "";
  const stage = groupLetter ? `Grupo ${groupLetter}` : "";
  const venue = m.venue || "";
  const meta = [stage, venue].filter(Boolean).join(" · ");
  const palpites = m.predictionCount > 0 ? ` · 🎯 ${m.predictionCount} palpite${m.predictionCount !== 1 ? "s" : ""}` : "";
  return meta ? `🏟️ ${meta}${palpites}` : palpites ? `🎯${palpites.slice(2)}` : "";
}

function formatMatch(m) {
  const kickoff = new Date(m.kickoff_at);
  const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const meta = formatMeta(m);
  const goals = formatGoals(m.goals);

  if (m.status === "finished") {
    const header = `✅ ${withFlag(m.home_team)} *${m.home_score} x ${m.away_score}* ${withFlag(m.away_team)}`;
    return [header, meta, goals].filter(Boolean).join("\n");
  }

  if (m.status === "live" || m.status === "paused" || m.status === "extra_time" || m.status === "penalties") {
    const score = m.home_score != null ? `${m.home_score} x ${m.away_score}` : "0 x 0";
    const statusTag = m.status === "extra_time" ? " — PRORROGAÇÃO" : m.status === "penalties" ? " — PÊNALTIS" : " — AO VIVO";
    const header = `🟢 ${withFlag(m.home_team)} *${score}* ${withFlag(m.away_team)}${statusTag}`;
    return [header, meta, goals].filter(Boolean).join("\n");
  }

  return [`⏰ ${time} — ${withFlag(m.home_team)} 🆚 ${withFlag(m.away_team)}`, meta].filter(Boolean).join("\n");
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
      for (const m of matches) {
        lines.push(formatMatch(m));
        lines.push("");  // linha em branco entre jogos
      }
      lines.pop(); // remove última linha em branco

      await client.sendMessage(chatId, lines.join("\n"));
    } catch (e) {
      logger.error("[jogoshoje]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar os jogos de hoje.");
    }
  },
};
