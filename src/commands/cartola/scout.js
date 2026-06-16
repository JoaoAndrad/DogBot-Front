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

module.exports = {
  name: "scout",
  aliases: ["scouts"],
  description: "Ver scouts do time Cartola de um usuário. Uso: /scout @usuario",

  async execute(ctx) {
    const { client, message, reply } = ctx;
    const chatId = message.from;

    // Sem menção → scouts do próprio usuário
    const mentionedIds = message.mentionedIds || [];
    let targetId = null;
    if (mentionedIds.length) {
      targetId = mentionedIds[0];
      if (targetId.includes("@lid")) {
        try {
          const contact = await client.getContactById(targetId);
          const jid = jidFromContact(contact);
          if (jid) targetId = jid;
        } catch (e) {
          logger.debug("[scout] getContactById:", e.message);
        }
      }
    } else {
      targetId = message.author || message.from;
      if (targetId.includes("@lid")) {
        try {
          const contact = await client.getContactById(targetId);
          const jid = jidFromContact(contact);
          if (jid) targetId = jid;
        } catch (e) {
          logger.debug("[scout] getContactById self:", e.message);
        }
      }
    }

    let saved;
    try {
      const res = await cartolaClient.getUserTeam(targetId);
      saved = res?.team;
    } catch (e) {
      logger.error("[scout] getUserTeam:", e.message);
      await reply("❌ Erro ao buscar dados. Tente novamente.");
      return;
    }

    if (!saved) {
      await reply(
        mentionedIds.length
          ? "⚽ Esse usuário ainda não vinculou o time no Cartola FC."
          : "⚽ Você ainda não vinculou seu time.\n\nUse */cartola → Configurações → Vincular meu time* no privado.",
      );
      return;
    }

    let data;
    try {
      const res = await cartolaClient.getMyTeamData(targetId);
      data = res?.data;
    } catch (e) {
      if (e.message?.includes("team_not_found") || e.message?.includes("no_team_saved")) {
        await reply(`⚽ *${saved.team_name || saved.slug}*\n\nTime não encontrado na API do Cartola.`);
      } else {
        logger.error("[scout] getMyTeamData:", e.message);
        await reply(`⚽ *${saved.team_name || saved.slug}*\n\n_Dados indisponíveis no momento._`);
      }
      return;
    }

    const time = data?.time || {};
    const atletas = data?.atletas || [];
    const capitaoId = data?.capitao_id;

    const comMovimento = atletas.filter(
      (a) => Object.values(a.scout || {}).some((v) => v > 0) || (a.pontos_num ?? 0) !== 0,
    );

    const lines = [`🔍 *Scouts — ${time.nome || saved.team_name || saved.slug}*`, ""];

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
