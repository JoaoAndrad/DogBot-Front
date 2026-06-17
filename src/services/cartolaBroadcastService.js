"use strict";

const logger = require("../utils/logger");
const { withFlag } = require("../utils/teamLocale");

const POSICAO = { 1: "GOL", 2: "LAT", 3: "ZAG", 4: "MEI", 5: "ATA", 6: "TEC" };

function fmt(n) {
  if (n == null) return "–";
  return Number(n).toFixed(2).replace(".", ",");
}

function buildScoutSummary(scout) {
  const LABELS = { G: "⚽", A: "🎯", FT: "🥅", FD: "🧤", FF: "💨", DS: "🛡️", CA: "🟨", CV: "🟥", GS: "🥅", PS: "⚡" };
  return Object.entries(scout || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${LABELS[k] || k}×${v}`)
    .join(" ");
}

async function processActions(client, actions) {
  const list = actions || [];

  // Agrupa time_completo e atleta_nao_jogou do mesmo groupId numa única mensagem
  const groupedCompleto = new Map(); // key: `${groupId}|${isCopa}` → [action, ...]
  const groupedNaoJogou = new Map();
  const remaining = [];
  for (const action of list) {
    const key = `${action.groupId}|${!!action.isCopa}`;
    if (action.kind === "time_completo") {
      if (!groupedCompleto.has(key)) groupedCompleto.set(key, []);
      groupedCompleto.get(key).push(action);
    } else if (action.kind === "atleta_nao_jogou") {
      if (!groupedNaoJogou.has(key)) groupedNaoJogou.set(key, []);
      groupedNaoJogou.get(key).push(action);
    } else {
      remaining.push(action);
    }
  }

  for (const [, batch] of groupedCompleto) {
    try {
      if (batch.length === 1) {
        await processOne(client, batch[0]);
      } else {
        const copa = batch[0].isCopa;
        const prefix = copa ? "🏆 " : "";
        const lines = [
          `${prefix}✅ *Times completos em campo*`,
          "",
          `Todos os atletas já jogaram nesta rodada:`,
          ...batch.map((a) => `• *${a.owner.displayName}* (${a.teamName || a.owner.displayName})`),
        ];
        await client.sendMessage(batch[0].groupId, lines.join("\n"));
      }
    } catch (e) {
      logger.warn("[cartolaBroadcast] time_completo falhou:", e.message);
    }
  }

  for (const [, batch] of groupedNaoJogou) {
    try {
      if (batch.length === 1) {
        await processOne(client, batch[0]);
      } else {
        const copa = batch[0].isCopa;
        const prefix = copa ? "🏆 " : "";
        // Agrupa por atleta → lista de donos
        const byAtleta = new Map(); // atletaNome → [displayName, ...]
        for (const a of batch) {
          for (const nome of (a.atletas || [])) {
            if (!byAtleta.has(nome)) byAtleta.set(nome, []);
            byAtleta.get(nome).push(a.owner.displayName);
          }
        }
        const lines = [`${prefix}🚨 *Atletas que não jogaram*`, ""];
        for (const [nome, donos] of byAtleta) {
          lines.push(`• *${nome}* — ${donos.join(", ")}`);
        }
        await client.sendMessage(batch[0].groupId, lines.join("\n"));
      }
    } catch (e) {
      logger.warn("[cartolaBroadcast] atleta_nao_jogou falhou:", e.message);
    }
  }

  for (const action of remaining) {
    try {
      await processOne(client, action);
    } catch (e) {
      logger.warn("[cartolaBroadcast] action falhou:", action.kind, e.message);
    }
  }
}

async function processOne(client, action) {
  const medals = ["🥇", "🥈", "🥉"];
  const copa = !!action.isCopa;

  switch (action.kind) {
    case "gol":
    case "assist":
    case "finalizacao_trave":
    case "cartao_vermelho":
    case "cartao_amarelo": {
      const lines = [
        `${copa ? "🏆 " : ""}${action.label} — *${action.athlete.apelido}*`,
        "",
      ];
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
      const prefix = copa ? "🏆 Copa do Cartola\n" : "";
      const lines = [
        `${prefix}🔄 *Virada no grupo!*`,
        "",
        `*${action.novoLider.displayName}* assumiu a liderança com *${fmt(action.novoLider.pontos)} pts*`,
        `Passou ${action.anteriorLider.displayName} (${fmt(action.anteriorLider.pontos)} pts)`,
      ];
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "parcial": {
      const ranking = action.ranking || [];
      let lines;
      if (copa && action.trigger) {
        const triggerLabel = action.trigger === "halftime" ? "⏸ Intervalo" : "🏁 Fim de jogo";
        const mc = action.matchContext;
        const scoreStr = mc && mc.homeScore != null ? ` ${mc.homeScore}x${mc.awayScore}` : "";
        const matchLine = mc ? `${withFlag(mc.homeTeam)}${scoreStr} ${withFlag(mc.awayTeam)}` : "";
        lines = [
          `🏆 *Copa do Cartola · ${triggerLabel}*`,
          matchLine,
          "",
          `📊 *Parcial — Rodada ${action.rodada}*`,
          "",
        ];
        for (let i = 0; i < ranking.length; i++) {
          const r = ranking[i];
          const pos = medals[i] || `${i + 1}.`;
          lines.push(`${pos} ${r.displayName} _(${r.teamName})_ — *${fmt(r.pontos)} pts*`);
        }
      } else {
        const title = copa
          ? `🏆 *Parcial Copa — Rodada ${action.rodada}*`
          : `📊 *Parcial — Rodada ${action.rodada}*`;
        lines = [title, ""];
        for (let i = 0; i < ranking.length; i++) {
          const r = ranking[i];
          const pos = medals[i] || `${i + 1}.`;
          lines.push(`${pos} ${r.displayName} — *${fmt(r.pontos)} pts*`);
          if (!copa) lines.push(`    🏠 ${r.teamName}`);
        }
      }
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "resultado_final": {
      const ranking = action.ranking || [];
      const title = copa
        ? `🏆 *Resultado Final Copa — Rodada ${action.rodada}*`
        : `🏁 *Resultado Final — Rodada ${action.rodada}*`;
      const lines = [title, ""];
      for (let i = 0; i < ranking.length; i++) {
        const r = ranking[i];
        const pos = medals[i] || `${i + 1}.`;
        lines.push(`${pos} ${r.displayName} — *${fmt(r.pontos)} pts*`);
      }
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

    case "capitao_em_campo": {
      const prefix = copa ? "🏆 " : "";
      const lines = [
        `${prefix}⭐ *Capitão em campo!*`,
        "",
        `*${action.athlete.apelido}* entrou em campo`,
        `Time de ${action.owner.displayName}`,
      ];
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "artilheiro": {
      const prefix = copa ? "🏆 " : "";
      const { apelido, gols } = action.athlete;
      const title = action.isHatTrick
        ? `${prefix}🎩 *Hat-trick! — ${apelido}*`
        : `${prefix}⚽ *Artilheiro da rodada — ${apelido}*`;
      const golStr = gols === 1 ? "1 gol" : `${gols} gols`;
      const lines = [title, "", `${golStr} marcados nesta rodada`];
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "quase_virada": {
      const prefix = copa ? "🏆 Copa do Cartola\n" : "";
      const diffStr = fmt(action.diff);
      const lines = [
        `${prefix}⚡ *Quase virada!*`,
        "",
        `*${action.lider.displayName}* lidera com *${fmt(action.lider.pontos)} pts*`,
        `*${action.perseguidor.displayName}* está a apenas *${diffStr} pts* atrás`,
      ];
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "time_completo": {
      const prefix = copa ? "🏆 " : "";
      const lines = [
        `${prefix}✅ *Time completo em campo*`,
        "",
        `Todos os atletas de *${action.owner.displayName}* já jogaram nesta rodada`,
        `_A pontuação de ${action.teamName || action.owner.displayName} está definida_`,
      ];
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    case "atleta_nao_jogou": {
      const prefix = copa ? "🏆 " : "";
      const lista = (action.atletas || []).map((n) => `• ${n}`).join("\n");
      const lines = [
        `${prefix}🚨 *Atleta não jogou*`,
        "",
        `Time de *${action.owner.displayName}*:`,
        lista,
        "",
        `_${action.atletas.length === 1 ? "Este atleta" : "Estes atletas"} não entraram em campo nesta rodada_`,
      ];
      await client.sendMessage(action.groupId, lines.join("\n"));
      break;
    }

    default:
      logger.warn("[cartolaBroadcast] action desconhecida:", action.kind);
  }
}

module.exports = { processActions };
