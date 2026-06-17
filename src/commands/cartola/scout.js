"use strict";

const fetch = require("node-fetch");
const cartolaClient = require("../../services/cartolaClient");
const logger = require("../../utils/logger");
const { jidFromContact } = require("../../utils/whatsapp/getUserData");

const POSICAO = { 1: "GOL", 2: "LAT", 3: "ZAG", 4: "MEI", 5: "ATA", 6: "TEC" };

const SCOUT_LABEL = {
  G:  "⚽ Gol",           A:  "🎯 Assist",       FT: "🥅 Trave",
  FD: "🥅 Fin.Defendida", FF: "💨 Fora",          DS: "🛡️ Desarme",
  FS: "⚠️ F.Sofrida",    SG: "🔒 S/Gol",        DE: "🧤 Defesa",
  DD: "🧤 Def.Difícil",  FC: "🦵 Falta",         V:  "✅ Vitória",
  CA: "🟨 Amarelo",      CV: "🟥 Vermelho",      I:  "🚑 Impedimento",
  PP: "❌ Pên.Perdido",  PC: "⚡ Pên.Comet.",    GC: "🚫 G.Contra",
  GS: "🥅 G.Sofrido",   PS: "⚡ Pên.Sofrido",
};

function fmt(n) {
  if (n == null) return "–";
  return Number(n).toFixed(2).replace(".", ",");
}

async function _sendShieldSticker(client, chatId, svgUrl) {
  try {
    const res = await fetch(svgUrl, { timeout: 8000 });
    if (!res.ok) return false;
    const buf = await res.buffer();
    const sharp = require("sharp");
    const pngBuf = await sharp(buf).png().toBuffer();
    const stickerHelper = require("../../utils/media/stickerHelper");
    return await stickerHelper.sendBufferAsSticker(client, chatId, pngBuf, { fullOnly: true });
  } catch (e) {
    logger.debug("[scout] sticker error:", e.message);
    return false;
  }
}

async function resolveId(client, rawId) {
  if (!rawId) return rawId;
  if (!String(rawId).includes("@lid")) return rawId;
  try {
    const contact = await client.getContactById(rawId);
    return jidFromContact(contact) || rawId;
  } catch (e) {
    logger.debug("[scout] resolveId:", e.message);
    return rawId;
  }
}

async function fetchTeamData(userId, tipo) {
  const savedRes = await cartolaClient.getUserTeam(userId, tipo);
  const saved = savedRes?.team || null;
  if (!saved) return { saved: null, data: null };
  const dataRes = await cartolaClient.getMyTeamData(userId, tipo);
  return { saved, data: dataRes?.data || null };
}

function buildScoutLines(saved, data, capitaoId) {
  const time = data?.time || {};
  const atletas = data?.atletas || [];
  const nome = time.nome || saved?.team_name || saved?.slug || "?";

  const comMovimento = atletas.filter(
    (a) => Object.values(a.scout || {}).some((v) => v > 0) || (a.pontos_num ?? 0) !== 0,
  );

  const lines = [];
  if (!comMovimento.length) {
    lines.push("  _Nenhum atleta pontuou ainda_");
  } else {
    for (const a of comMovimento) {
      const isCap = a.atleta_id === capitaoId;
      const pts = fmt(isCap ? (a.pontos_num ?? 0) * 2 : (a.pontos_num ?? 0));
      const pos = POSICAO[a.posicao_id] || "?";
      const entries = Object.entries(a.scout || {}).filter(([, v]) => v > 0);
      const scoutStr = entries.length
        ? ` (${entries.map(([k, v]) => `${SCOUT_LABEL[k] || k}${v > 1 ? ` ×${v}` : ""}`).join(", ")})`
        : "";
      lines.push(`  • [${pos}] ${a.apelido || a.nome}${isCap ? " ⭐" : ""} — ${pts} pts${scoutStr}`);
    }
  }

  const total = data?.pontos != null ? fmt(data.pontos) : null;
  return { nome, lines, total, svgUrl: time.url_escudo_svg || null };
}

// ─── Detecção de modo versus ──────────────────────────────────────────────────

const VERSUS_RE = /\b(x|vs|versus|\+)\b/i;

function isVersusMode(body) {
  const afterCmd = body.replace(/^[!/]\w+\s*/, "");
  return VERSUS_RE.test(afterCmd);
}

function bodyHasEu(body) {
  return /\beu\b/i.test(body);
}

module.exports = {
  name: "scout",
  aliases: ["scouts"],
  description: "Ver scouts do time Cartola. /scout @usuario | /scout @a vs @b | /scout @a x eu",

  async execute(ctx) {
    const { client, message, reply } = ctx;
    const chatId = message.from;
    const senderId = message.author || message.from;

    const mentionedIds = message.mentionedIds || [];
    const body = message.body || "";

    // Detecta tipo pela liga do grupo
    let tipo = "brasileirao";
    const isGroup = String(chatId).endsWith("@g.us");
    if (isGroup) {
      try {
        const leagueData = await cartolaClient.getGroupLeague(chatId);
        if (leagueData?.league?.tipo?.startsWith("copa/")) tipo = "copa";
      } catch {}
    }

    const icon = tipo === "copa" ? "🏆" : "⚽";
    const label = tipo === "copa" ? "Copa do Cartola" : "Cartola FC";

    // ── Resolve IDs de menções ────────────────────────────────────────────────
    const resolvedMentions = await Promise.all(
      mentionedIds.map((id) => resolveId(client, id)),
    );

    const resolvedSender = await resolveId(client, senderId);

    // ── Modo versus ───────────────────────────────────────────────────────────
    const versus = isVersusMode(body);

    if (versus) {
      // Determina os dois lados
      let idA, idB;
      if (resolvedMentions.length >= 2) {
        [idA, idB] = resolvedMentions;
      } else if (resolvedMentions.length === 1) {
        // um lado é a menção, o outro é "eu" (sender) — independente de qual ordem
        idA = resolvedMentions[0];
        idB = resolvedSender;
      } else {
        await reply(`${icon} Use: */scout @alguém x eu* ou */scout @a vs @b*`);
        return;
      }

      // Busca paralela
      let resA, resB;
      try {
        [resA, resB] = await Promise.all([
          fetchTeamData(idA, tipo),
          fetchTeamData(idB, tipo),
        ]);
      } catch (e) {
        logger.error("[scout versus] fetchTeamData:", e.message);
        await reply("❌ Erro ao buscar dados. Tente novamente.");
        return;
      }

      if (!resA.saved) {
        await reply(`${icon} O primeiro usuário ainda não vinculou o time no ${label}.`);
        return;
      }
      if (!resB.saved) {
        await reply(`${icon} O segundo usuário ainda não vinculou o time no ${label}.`);
        return;
      }

      const sideA = buildScoutLines(resA.saved, resA.data, resA.data?.capitao_id);
      const sideB = buildScoutLines(resB.saved, resB.data, resB.data?.capitao_id);

      const totalA = resA.data?.pontos ?? 0;
      const totalB = resB.data?.pontos ?? 0;
      const diff = Math.abs(totalA - totalB);
      const leader = totalA > totalB ? sideA.nome : totalB > totalA ? sideB.nome : null;

      const placarLine = leader
        ? `📊 *${leader}* lidera por *+${fmt(diff)} pts*`
        : `📊 *Empate!* — ${fmt(totalA)} pts cada`;

      const lines = [
        `⚔️ *${sideA.nome}* × *${sideB.nome}*${tipo === "copa" ? " _(Copa)_" : ""}`,
        "",
        `*${sideA.nome}* — ${sideA.total ?? "–"} pts`,
        ...sideA.lines,
        "",
        `*${sideB.nome}* — ${sideB.total ?? "–"} pts`,
        ...sideB.lines,
        "",
        placarLine,
      ];

      await reply(lines.join("\n"));
      return;
    }

    // ── Modo normal (scout de um usuário) ─────────────────────────────────────
    let targetId = resolvedMentions.length ? resolvedMentions[0] : resolvedSender;

    let saved;
    try {
      const res = await cartolaClient.getUserTeam(targetId, tipo);
      saved = res?.team;
    } catch (e) {
      logger.error("[scout] getUserTeam:", e.message);
      await reply("❌ Erro ao buscar dados. Tente novamente.");
      return;
    }

    if (!saved) {
      await reply(
        mentionedIds.length
          ? `${icon} Esse usuário ainda não vinculou o time no ${label}.`
          : `${icon} Você ainda não vinculou seu time no ${label}.\n\nUse */cartola → Configurações → Vincular meu time* no privado.`,
      );
      return;
    }

    let data;
    try {
      const res = await cartolaClient.getMyTeamData(targetId, tipo);
      data = res?.data;
    } catch (e) {
      if (e.message?.includes("team_not_found") || e.message?.includes("no_team_saved")) {
        await reply(`${icon} *${saved.team_name || saved.slug}*\n\nTime não encontrado na API do Cartola.`);
      } else {
        logger.error("[scout] getMyTeamData:", e.message);
        await reply(`${icon} *${saved.team_name || saved.slug}*\n\n_Dados indisponíveis no momento._`);
      }
      return;
    }

    const time = data?.time || {};
    const atletas = data?.atletas || [];
    const capitaoId = data?.capitao_id;
    const isCopa = tipo === "copa";

    const comMovimento = atletas.filter(
      (a) => Object.values(a.scout || {}).some((v) => v > 0) || (a.pontos_num ?? 0) !== 0,
    );

    const lines = [`🔍 *Scouts — ${time.nome || saved.team_name || saved.slug}*${isCopa ? " _(Copa)_" : ""}`, ""];

    if (!comMovimento.length) {
      lines.push("_Nenhum atleta pontuou ainda nesta rodada._");
    } else {
      for (const a of comMovimento) {
        const isCap = a.atleta_id === capitaoId;
        const pts = fmt(isCap ? (a.pontos_num ?? 0) * 2 : (a.pontos_num ?? 0));
        const pos = POSICAO[a.posicao_id] || "?";
        lines.push("");
        lines.push(`*[${pos}] ${a.apelido || a.nome}${isCap ? " ⭐" : ""}* — ${pts} pts`);
        const entries = Object.entries(a.scout || {}).filter(([, v]) => v > 0);
        if (entries.length) {
          lines.push(`  └ ${entries.map(([k, v]) => `${SCOUT_LABEL[k] || k}${v > 1 ? ` ×${v}` : ""}`).join(", ")}`);
        }
      }
    }

    if (data?.pontos != null) {
      lines.push("", `📊 *Total: ${fmt(data.pontos)} pts*`);
    }

    await reply(lines.join("\n"));

    if (time.url_escudo_svg) {
      await _sendShieldSticker(client, chatId, time.url_escudo_svg);
    }
  },
};
