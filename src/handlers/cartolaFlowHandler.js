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
  // Copa: cartola.globo.com/#!/copa/time/{id}
  const mCopa = s.match(/cartola\.globo\.com\/(?:#!\/)?copa\/time\/(\d+)/i);
  if (mCopa) return { id: mCopa[1], tipo: "copa" };
  // Brasileirão: cartola.globo.com/#!/time/{id|slug}
  const m = s.match(/cartola\.globo\.com\/(?:#!\/)?time\/([^/?&#\s]+)/i);
  if (m) return { id: m[1], tipo: "brasileirao" };
  // Só ID numérico — pode ser Copa ou Brasileirão (ambíguo, usa contexto)
  if (/^\d+$/.test(s)) return { id: s, tipo: null };
  // Slug — assume Brasileirão
  return { id: s.toLowerCase().replace(/\s+/g, "-"), tipo: "brasileirao" };
}

/**
 * Extrai slug de liga de URL ou retorna o texto como slug.
 *   - https://cartola.globo.com/#!/competicoes/pontoscorridos/d5uku6ak58ms73dfplg0
 *   - https://cartola.globo.com/ligas/minha-liga  (formato alternativo)
 *   - d5uku6ak58ms73dfplg0  (só o slug)
 */
const RE_COMP = /cartola\.globo\.com\/(?:#!\/)?(?:[^/?&#\s/]+\/)*competicoes\/([^/?&#\s/]+)\/([^/?&#\s]+)/i;
const RE_COPA_PREFIX = /cartola\.globo\.com\/(?:#!\/)?copa\/competicoes\//i;
const RE_LIGA = /cartola\.globo\.com\/(?:#!\/)?(?:[^/?&#\s/]+\/)*ligas\/([^/?&#\s]+)/i;
const RE_CARTOLA_URL = /https?:\/\/[^\s]*cartola\.globo\.com[^\s]*/gi;

function _tryParseUrl(url) {
  const mComp = url.match(RE_COMP);
  if (mComp) {
    const isCopa = RE_COPA_PREFIX.test(url);
    const tipo = isCopa ? `copa/${mComp[1].toLowerCase()}` : mComp[1].toLowerCase();
    return { slug: mComp[2].toLowerCase(), tipo };
  }
  const mLiga = url.match(RE_LIGA);
  if (mLiga) return { slug: mLiga[1].toLowerCase(), tipo: "liga" };
  return null;
}

function parseLeagueInput(raw) {
  const s = raw.trim();

  // 1. Tenta achar URL de competição/liga em qualquer ponto do texto
  //    (cobre mensagens multi-linha com texto + URL, e múltiplos URLs)
  const allUrls = [...s.matchAll(RE_CARTOLA_URL)].map((m) => m[0]);
  for (const url of allUrls) {
    const result = _tryParseUrl(url);
    if (result) return result;
  }

  // 2. Texto puro sem URL — só aceita se for uma única palavra/slug
  if (/^[^\s]+$/.test(s)) return { slug: s.toLowerCase(), tipo: null };

  return { slug: "", tipo: null };
}

// ─── Vincular time ────────────────────────────────────────────────────────────

async function handleCartolaTeamFlow(stateKey, body, state, reply, opts = {}) {
  const data = state.data || {};

  if (data.step !== "await_slug") {
    conversationState.clearState(stateKey);
    return false;
  }

  const parsed = parseTeamInput(body);
  const contextTipo = data.tipo || "brasileirao";
  const id = parsed.id;

  if (!id || id.length < 2) {
    await reply("❌ Entrada inválida. Tente novamente.\n_(ou /cancelar para sair)_");
    return true;
  }

  // Rejeita se o URL enviado é claramente do tipo errado
  if (parsed.tipo && parsed.tipo !== contextTipo) {
    const expected = contextTipo === "copa"
      ? "_cartola.globo.com/#!/copa/time/*123456*_"
      : "_cartola.globo.com/#!/time/*123456*_";
    const label = contextTipo === "copa" ? "Copa do Cartola" : "Brasileirão";
    await reply(`❌ Este link é de um time do ${parsed.tipo === "copa" ? "Copa" : "Brasileirão"}, mas você está vinculando um time do *${label}*.\n\nEnvie o URL ou ID correto:\n${expected}\n_(ou /cancelar para sair)_`);
    return true;
  }

  const tipo = parsed.tipo || contextTipo;

  try {
    const userId = data.userId || stateKey;
    const result = await cartolaClient.saveUserTeam(userId, id, tipo);
    conversationState.clearState(stateKey);

    const nome = result.team_name || id;
    const isCopa = tipo === "copa";
    await reply(`✅ *Time ${isCopa ? "Copa " : ""}vinculado!*\n\n${isCopa ? "🏆" : "🇧🇷"} *${nome}*\n\nUse */cartola → Meu time* para ver sua pontuação.`);
    const { client, chatId } = opts;
    if (result.shield_url && client && chatId) {
      await _sendShieldSticker(client, chatId, result.shield_url);
    }
    logger.debug(`[cartola-team] ${stateKey.split("@")[0]} → ${id} (${tipo})`);
  } catch (e) {
    const hint = tipo === "copa"
      ? `_cartola.globo.com/#!/copa/time/*50271939*_`
      : `_cartola.globo.com/#!/time/*19513040*_`;
    if (e.message?.includes("team_not_found")) {
      // Mantém o estado ativo para o usuário tentar novamente
      await reply(`❌ Time não encontrado.\n\nTente novamente com o ID numérico ou URL completa:\n${hint}\n_(ou /cancelar para sair)_`);
    } else {
      conversationState.clearState(stateKey);
      await reply("❌ Erro ao vincular time. Tente novamente mais tarde.");
    }
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

  const parsed = parseLeagueInput(body);
  const { slug, tipo } = parsed;
  if (!slug || slug.length < 2) {
    await reply(
      "❌ Não consegui encontrar um link de liga válido.\n\nEnvie o link da sua liga no Cartola FC, por exemplo:\n_cartola.globo.com/#!/competicoes/pontoscorridos/*slug*_\n_(ou /cancelar para sair)_",
    );
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
    const result = await cartolaClient.saveGroupLeague(groupId, slug, userId, tipo);
    conversationState.clearState(stateKey);

    const nome = result.name || slug;
    await reply(
      `✅ *Liga vinculada ao grupo!*\n\n🏆 *${nome}*\n\nUse */cartola → Ranking da liga* para ver a classificação.`,
    );
    logger.debug(`[cartola-league] ${groupId} → ${slug} (${tipo || "auto"})`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = e.message?.includes("league_not_found")
      ? `❌ Liga não encontrada.\n\nVerifique se o link está correto e tente novamente:\n_cartola.globo.com/#!/competicoes/pontoscorridos/*slug*_`
      : e.message?.includes("401")
        ? `🔒 Esta liga é privada e requer autenticação.\n\nO bot precisa de credenciais configuradas para acessá-la. Fale com o admin.`
        : `❌ Erro ao vincular liga. Tente novamente mais tarde.`;
    await reply(msg);
    logger.error("[cartola-league] saveGroupLeague:", e.message);
  }

  return true;
}

module.exports = { handleCartolaTeamFlow, handleCartolaLeagueFlow };
