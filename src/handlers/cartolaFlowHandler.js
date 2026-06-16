"use strict";

const fetch = require("node-fetch");
const conversationState = require("../services/conversationState");
const cartolaClient = require("../services/cartolaClient");
const logger = require("../utils/logger");

async function _sendShieldSticker(client, chatId, svgUrl) {
  try {
    const res = await fetch(svgUrl, { timeout: 8000 });
    if (!res.ok) return false;
    const buf = await res.buffer();
    const sharp = require("sharp");
    const pngBuf = await sharp(buf).png().toBuffer();
    const stickerHelper = require("../utils/media/stickerHelper");
    return await stickerHelper.sendBufferAsSticker(client, chatId, pngBuf, { fullOnly: true });
  } catch (e) {
    logger.debug("[cartola-shield] sticker error:", e.message);
    return false;
  }
}

// ─── Parsers de input ────────────────────────────────────────────────────────

/**
 * Extrai ID/slug de qualquer formato que o usuário possa mandar:
 *   - URL completa: https://cartola.globo.com/#!/time/19513040
 *   - URL sem hash:  https://cartola.globo.com/time/meu-time
 *   - Só o ID:       19513040
 *   - Só o slug:     meu-time
 */
function parseTeamInput(raw) {
  const s = raw.trim();
  // URL do Cartola FC — captura o segmento após /time/
  const m = s.match(/cartola\.globo\.com\/(?:#!\/)?time\/([^/?&#\s]+)/i);
  if (m) return m[1];
  // Slugs usam hífens — normaliza espaços
  return s.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Extrai slug de liga de URL ou retorna o texto como slug.
 *   - https://cartola.globo.com/#!/competicoes/pontoscorridos/d5uku6ak58ms73dfplg0
 *   - https://cartola.globo.com/ligas/minha-liga  (formato alternativo)
 *   - d5uku6ak58ms73dfplg0  (só o slug)
 */
function parseLeagueInput(raw) {
  const s = raw.trim();
  // /#!/competicoes/{tipo}/{slug} ou /ligas/{slug}
  const m = s.match(
    /cartola\.globo\.com\/(?:#!\/)?(?:competicoes\/[^/?&#\s/]+|ligas)\/([^/?&#\s]+)/i,
  );
  if (m) return m[1].toLowerCase();
  return s.toLowerCase();
}

// ─── Vincular time ────────────────────────────────────────────────────────────

async function handleCartolaTeamFlow(stateKey, body, state, reply, opts = {}) {
  const data = state.data || {};

  if (data.step !== "await_slug") {
    conversationState.clearState(stateKey);
    return false;
  }

  const slug = parseTeamInput(body);
  if (!slug || slug.length < 2) {
    await reply("❌ Entrada inválida. Tente novamente.\n_(ou /cancelar para sair)_");
    return true;
  }

  try {
    const userId = data.userId || stateKey;
    const result = await cartolaClient.saveUserTeam(userId, slug);
    conversationState.clearState(stateKey);

    const nome = result.team_name || slug;
    await reply(`✅ *Time vinculado!*\n\n⚽ *${nome}*\n\nUse */cartola → Meu time* para ver sua pontuação.`);
    const { client, chatId } = opts;
    if (result.shield_url && client && chatId) {
      await _sendShieldSticker(client, chatId, result.shield_url);
    }
    logger.info(`[cartola-team] ${stateKey.split("@")[0]} → ${slug}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = e.message?.includes("team_not_found")
      ? `❌ Time não encontrado para *${slug}*.\n\nTente com o ID numérico ou URL completa:\n_cartola.globo.com/#!/time/*19513040*_`
      : `❌ Erro ao vincular time. Tente novamente mais tarde.`;
    await reply(msg);
    logger.error("[cartola-team] saveUserTeam:", e.message);
  }

  return true;
}

// ─── Vincular liga (slug input) ───────────────────────────────────────────────

async function handleCartolaLeagueFlow(stateKey, body, state, reply) {
  const data = state.data || {};

  if (data.step !== "await_slug") {
    conversationState.clearState(stateKey);
    return false;
  }

  const slug = parseLeagueInput(body);
  if (!slug || slug.length < 2) {
    await reply("❌ Entrada inválida. Tente novamente.\n_(ou /cancelar para sair)_");
    return true;
  }

  const groupId = data.groupId;
  if (!groupId) {
    conversationState.clearState(stateKey);
    await reply("❌ Sessão expirada. Use */cartola* novamente.");
    return true;
  }

  try {
    const userId = data.userId || stateKey;
    const result = await cartolaClient.saveGroupLeague(groupId, slug, userId);
    conversationState.clearState(stateKey);

    const nome = result.name || slug;
    await reply(
      `✅ *Liga vinculada ao grupo!*\n\n🏆 *${nome}*\n\nUse */cartola → Ranking da liga* para ver a classificação.`,
    );
    logger.info(`[cartola-league] ${groupId} → ${slug}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = e.message?.includes("league_not_found")
      ? `❌ Liga não encontrada para *${slug}*.\n\nVerifique a URL no Cartola FC e tente novamente:\n_cartola.globo.com/#!/competicoes/pontoscorridos/*slug*_`
      : e.message?.includes("401")
        ? `🔒 Esta liga é privada e requer autenticação.\n\nO bot precisa de credenciais configuradas para acessá-la. Fale com o admin.`
        : `❌ Erro ao vincular liga. Tente novamente mais tarde.`;
    await reply(msg);
    logger.error("[cartola-league] saveGroupLeague:", e.message);
  }

  return true;
}

module.exports = { handleCartolaTeamFlow, handleCartolaLeagueFlow };
