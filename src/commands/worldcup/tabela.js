"use strict";

const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

function parseGroupArg(body) {
  // "/tabela grupo a" | "/tabela grupo b" | "/grupo a" | "/grupo c"
  const m = body.match(/(?:tabela\s+)?grupo\s+([a-hA-H])/i) || body.match(/\bgrupo\s+([a-hA-H])\b/i);
  if (m) return m[1].toUpperCase();
  // just a letter at end: "/tabela a"
  const m2 = body.match(/\b([a-hA-H])\b/i);
  if (m2) return m2[1].toUpperCase();
  return null;
}

function formatStandings(standings, groupName) {
  const header = groupName ? `📊 *Grupo ${groupName}*` : "📊 *Classificação*";
  const lines = [header, "```", "Pos  Time          Pts  PJ  SG", "─────────────────────────────────"];

  for (const s of standings) {
    const pos = String(s.position || standings.indexOf(s) + 1).padEnd(3);
    const team = (s.team || "").slice(0, 12).padEnd(13);
    const pts = String(s.points).padEnd(4);
    const played = String(s.played).padEnd(3);
    const gd = s.gd >= 0 ? `+${s.gd}` : String(s.gd);
    lines.push(`${pos}  ${team}  ${pts} ${played} ${gd}`);
  }

  lines.push("```");
  return lines.join("\n");
}

module.exports = {
  name: "tabela",
  aliases: ["grupo"],
  description: "Exibe a classificação da Copa do Mundo. Ex: /tabela grupo a",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const body = (message.body || "").trim().toLowerCase();
    const groupLetter = parseGroupArg(body);

    try {
      const { standings } = await worldcupClient.getStandings(groupLetter ? `Group ${groupLetter}` : null);

      if (!standings || !standings.length) {
        await client.sendMessage(chatId, "⚽ Nenhuma classificação disponível ainda.\nUse */tabela grupo A* (substitua A pela letra do grupo).");
        return;
      }

      if (groupLetter) {
        await client.sendMessage(chatId, formatStandings(standings, groupLetter));
        return;
      }

      // All groups — group by group_name and send one message per group
      const byGroup = {};
      for (const s of standings) {
        const g = s.group_name || "?";
        if (!byGroup[g]) byGroup[g] = [];
        byGroup[g].push(s);
      }

      const blocks = [];
      for (const [g, rows] of Object.entries(byGroup)) {
        const letter = g.replace("Group ", "");
        blocks.push(formatStandings(rows, letter));
      }

      await client.sendMessage(chatId, blocks.join("\n\n"));
    } catch (e) {
      logger.error("[tabela]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar a tabela.");
    }
  },
};
