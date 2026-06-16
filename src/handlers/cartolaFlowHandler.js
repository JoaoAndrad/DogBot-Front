"use strict";

const conversationState = require("../services/conversationState");
const cartolaClient = require("../services/cartolaClient");
const logger = require("../utils/logger");

// ─── Vincular time (slug input) ───────────────────────────────────────────────

async function handleCartolaTeamFlow(stateKey, body, state, reply) {
  const data = state.data || {};

  if (data.step !== "await_slug") {
    conversationState.clearState(stateKey);
    return false;
  }

  const slug = body.trim().toLowerCase();
  if (!slug || slug.length < 2) {
    await reply("❌ Slug inválido. Tente novamente.\n_(ou /cancelar para sair)_");
    return true;
  }

  try {
    const userId = data.userId || stateKey;
    const result = await cartolaClient.saveUserTeam(userId, slug);
    conversationState.clearState(stateKey);

    const nome = result.team_name || slug;
    await reply(
      `✅ *Time vinculado!*\n\n⚽ *${nome}*\n\nUse */cartola → Meu time* para ver sua pontuação.`,
    );
    logger.info(`[cartola-team] ${stateKey.split("@")[0]} → ${slug}`);
  } catch (e) {
    conversationState.clearState(stateKey);
    const msg = e.message === "team_not_found"
      ? `❌ Time não encontrado para o slug *${slug}*.\nVerifique a URL no Cartola FC e tente novamente.`
      : `❌ Erro ao vincular time: ${e.message}`;
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

  const slug = body.trim().toLowerCase();
  if (!slug || slug.length < 2) {
    await reply("❌ Slug inválido. Tente novamente.\n_(ou /cancelar para sair)_");
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
    const msg = e.message === "league_not_found"
      ? `❌ Liga não encontrada para o slug *${slug}*.\nVerifique a URL no Cartola FC e tente novamente.`
      : `❌ Erro ao vincular liga: ${e.message}`;
    await reply(msg);
    logger.error("[cartola-league] saveGroupLeague:", e.message);
  }

  return true;
}

module.exports = { handleCartolaTeamFlow, handleCartolaLeagueFlow };
