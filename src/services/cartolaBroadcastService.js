"use strict";

const logger = require("../utils/logger");

const POSICAO = { 1: "GOL", 2: "LAT", 3: "ZAG", 4: "MEI", 5: "ATA", 6: "TEC" };

function fmt(n) {
  if (n == null) return "–";
  return Number(n).toFixed(2).replace(".", ",");
}

function buildScoutSummary(scout) {
  const LABELS = { G: "⚽", A: "🎯", FT: "🥅", FD: "🧤", FF: "💨", DS: "🛡️", CA: "🟨", CV: "🟥" };
  return Object.entries(scout || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${LABELS[k] || k}×${v}`)
    .join(" ");
}

async function processActions(client, actions) {
  for (const action of actions || []) {
    try {
      await processOne(client, action);
    } catch (e) {
      logger.warn("[cartolaBroadcast] action falhou:", action.kind, e.message);
    }
  }
}

async function processOne(client, action) {
  const medals = ["🥇", "🥈", "🥉"];

  switch (action.kind) {
    case "gol":
    case "assist":
    case "finalizacao_trave":
    case "cartao_vermelho":
    case "cartao_amarelo": {
      const lines = [`${action.label} — *${action.athlete.apelido}*`, ""];
      const impacto = action.impacto || [];
      if (impacto.length) {
        lines.push("Impacto no grupo:");
        for (const i of impacto) {
          const capMark = i.is_capitao ? " ⭐" : "";
          const sign = i.pts_extra >= 0 ? "+" : "";
          lines.push(`• ${i.displayName || i.userId}${capMark} ${sign}${fmt(i.pts_extra)} pts`);
        }
      }
      const scouts = buildScoutSummary(action.athlete.scout);
      if (scouts) lines.push("", `📊 ${action.athlete.apelido}: ${scouts}`);
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "virada": {
      const lines = [
        "🔄 *Virada no grupo!*",
        "",
        `*${action.novoLider.displayName}* assumiu a liderança com *${fmt(action.novoLider.pontos)} pts*`,
        `Passou ${action.anteriorLider.displayName} (${fmt(action.anteriorLider.pontos)} pts)`,
      ];
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "parcial": {
      const lines = [`📊 *Parcial — Rodada ${action.rodada}*`, ""];
      const ranking = action.ranking || [];
      for (let i = 0; i < ranking.length; i++) {
        const r = ranking[i];
        const pos = medals[i] || `${i + 1}.`;
        lines.push(`${pos} ${r.displayName} — *${fmt(r.pontos)} pts*`);
        lines.push(`    🏠 ${r.teamName}`);
      }
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "resultado_final": {
      const ranking = action.ranking || [];
      const lines = [`🏁 *Resultado Final — Rodada ${action.rodada}*`, ""];
      for (let i = 0; i < ranking.length; i++) {
        const r = ranking[i];
        const pos = medals[i] || `${i + 1}.`;
        lines.push(`${pos} ${r.displayName} — *${fmt(r.pontos)} pts*`);
      }
      // Highlight top scorer and most damaging player
      if (ranking.length) {
        const allAtletas = ranking.flatMap((r) =>
          (r.atletas || []).map((a) => ({ ...a, owner: r.displayName }))
        );
        const topAtleta = allAtletas.sort((a, b) => (b.pontos_num ?? 0) - (a.pontos_num ?? 0))[0];
        if (topAtleta) {
          lines.push("", `🔥 *Destaque:* ${topAtleta.apelido} — ${fmt(topAtleta.pontos_num)} pts (${topAtleta.owner})`);
        }
      }
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    default:
      logger.warn("[cartolaBroadcast] action desconhecida:", action.kind);
  }
}

module.exports = { processActions };
