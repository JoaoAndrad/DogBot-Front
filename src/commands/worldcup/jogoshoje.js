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

function teamFlag(teamName) {
  if (!teamName) return "";
  return localize(teamName).flag || "";
}

function formatGoalLine(g) {
  const min = g.minute != null ? `${g.minute}' ` : "";
  const name = goat(g.scorer) || "";
  const flag = teamFlag(g.team);
  return `   ⚽ ${min}${name}${flag ? ` ${flag}` : ""}`.trimEnd();
}

function formatMissLine(miss) {
  const name = miss.player || "";
  const flag = teamFlag(miss.team);
  return `   ❌ ${name}${flag ? ` ${flag}` : ""} _(pênalti perdido)_`.trimEnd();
}

function formatMeta(m) {
  const groupLetter = m.group_name ? m.group_name.replace(/^GROUP_?/i, "").replace(/^Group\s*/i, "").trim() : "";
  const stage = groupLetter ? `Grupo ${groupLetter}` : "";
  const venue = m.venue || "";
  const meta = [stage, venue].filter(Boolean).join(" · ");
  let palpites = m.predictionCount > 0 ? `🎯 ${m.predictionCount} palpite${m.predictionCount !== 1 ? "s" : ""}` : "";
  if (palpites && m.exactScoreCount != null) {
    palpites += ` · ✅ ${m.exactScoreCount} acertaram o placar`;
  }
  return [meta ? `🏟️ ${meta}` : "", palpites].filter(Boolean).join("\n");
}

function formatMatch(m) {
  const kickoff = new Date(m.kickoff_at);
  const time = kickoff.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  const meta = formatMeta(m);

  if (m.status === "finished") {
    const hasET = m.extra_time_home != null;
    const wentToPen = hasET && m.extra_time_home === m.extra_time_away;
    const wentToET = hasET && !wentToPen;

    const tag = wentToPen ? " _(pênaltis)_" : wentToET ? " _(prorrogação)_" : "";
    const header = `✅ ${withFlag(m.home_team)} *${m.home_score} x ${m.away_score}* ${withFlag(m.away_team)}${tag}`;

    let advancing = null;
    if (m.actual_advancing_team) {
      const advText = withFlag(m.actual_advancing_team);
      advancing = wentToPen
        ? `🏅 ${advText} avança nos pênaltis`
        : `🏅 ${advText} avança`;
    }

    const lines = [header, advancing, meta].filter(Boolean);

    if (hasET) {
      // Split goals into regular / ET / penalty sections
      const regularCount = (m.home_score ?? 0) + (m.away_score ?? 0);
      // extra_time fields may be cumulative (includes 90min) or was reset to 0 by the API during
      // the penalty period. Guard against negative values.
      const etGoalCount = Math.max(0, ((m.extra_time_home ?? 0) + (m.extra_time_away ?? 0)) - regularCount);
      const allGoals = (m.goals || []);
      const regularGoals = allGoals.slice(0, regularCount);
      const etGoals = allGoals.slice(regularCount, regularCount + etGoalCount);
      const penGoals = wentToPen ? allGoals.slice(regularCount + etGoalCount) : [];

      // Tempo regular
      if (regularGoals.length) {
        lines.push("*Tempo regular:*");
        regularGoals.forEach((g) => lines.push(formatGoalLine(g)));
      }

      // Prorrogação
      if (etGoals.length) {
        lines.push("*Prorrogação:*");
        etGoals.forEach((g) => lines.push(formatGoalLine(g)));
      } else {
        lines.push("*Prorrogação:* _(sem gols)_");
      }

      // Pênaltis
      if (wentToPen) {
        const penScore = m.penalties_home != null && m.penalties_away != null
          ? ` (${m.home_team.split(" ")[0]} ${m.penalties_home}–${m.penalties_away} ${m.away_team.split(" ")[0]})`
          : "";
        lines.push(`*Pênaltis:*${penScore}`);

        const penItems = [
          ...penGoals.map((g) => ({ minute: g.minute, type: "goal", scorer: g.scorer, team: g.team })),
          ...(m.misses || []).map((miss) => ({ minute: miss.minute, type: "miss", player: miss.player, team: miss.team })),
        ].sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));

        if (penItems.length) {
          penItems.forEach((item) => {
            if (item.type === "goal") lines.push(formatGoalLine({ minute: null, scorer: item.scorer, team: item.team }));
            else lines.push(formatMissLine({ player: item.player, team: item.team }));
          });
        }
      }
    } else {
      // Regular 90min match — show goals inline
      const goals = (m.goals || []);
      if (goals.length) goals.forEach((g) => lines.push(formatGoalLine(g)));
    }

    return lines.join("\n");
  }

  if (m.status === "live" || m.status === "paused" || m.status === "extra_time" || m.status === "penalties") {
    const score = m.home_score != null ? `${m.home_score} x ${m.away_score}` : "0 x 0";
    const statusTag = m.status === "extra_time" ? " — PRORROGAÇÃO" : m.status === "penalties" ? " — PÊNALTIS" : " — AO VIVO";
    const header = `🟢 ${withFlag(m.home_team)} *${score}* ${withFlag(m.away_team)}${statusTag}`;
    const goals = (m.goals || []);
    const goalLines = goals.map(formatGoalLine);
    return [header, meta, ...goalLines].filter(Boolean).join("\n");
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
        lines.push("");
      }
      lines.pop();

      await client.sendMessage(chatId, lines.join("\n"));
    } catch (e) {
      logger.error("[jogoshoje]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar os jogos de hoje.");
    }
  },
};
