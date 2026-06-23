"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const STATE_FILE = path.join(DATA_DIR, "dm-alert-ignored.json");
const MAX_IGNORED = 3;

// Formato do JSON:
// { missed: { jid: [matchId, ...] }, autoDisabled: { jid: true } }
// Compatibilidade retroativa: se carregar formato antigo { jid: [...] }, migra automaticamente.

function _load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (raw.missed !== undefined || raw.autoDisabled !== undefined) return raw;
    // Formato antigo: { jid: [...] } — migrar
    return { missed: raw, autoDisabled: {} };
  } catch {
    return { missed: {}, autoDisabled: {} };
  }
}

function _save(state) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    // não-crítico
  }
}

/**
 * Registra que um alerta de 1h foi enviado para jid sobre matchId.
 * Retorna o número de matchIds consecutivos ignorados (sem palpite) para esse usuário.
 */
function recordAlert(jid, matchId) {
  const state = _load();
  if (!state.missed[jid]) state.missed[jid] = [];
  if (!state.missed[jid].includes(matchId)) state.missed[jid].push(matchId);
  _save(state);
  return state.missed[jid].length;
}

/**
 * Chamado quando o sistema auto-desativa o usuário após MAX_IGNORED consecutivos.
 * Limpa o histórico de missed e marca como auto-desativado.
 */
function markAutoDisabled(jid) {
  const state = _load();
  delete state.missed[jid];
  state.autoDisabled[jid] = true;
  _save(state);
}

/**
 * Retorna true se o usuário foi desativado automaticamente pelo sistema.
 */
function isAutoDisabled(jid) {
  const state = _load();
  return !!state.autoDisabled[jid];
}

/**
 * Remove completamente o histórico de um usuário (chamado quando palpita).
 * Retorna true se estava auto-desativado, para que o chamador possa re-ativar os alertas.
 */
function clearUser(jid) {
  const state = _load();
  const wasAutoDisabled = !!state.autoDisabled[jid];
  delete state.missed[jid];
  delete state.autoDisabled[jid];
  _save(state);
  return wasAutoDisabled;
}

function getCount(jid) {
  const state = _load();
  return (state.missed[jid] || []).length;
}

module.exports = { recordAlert, markAutoDisabled, isAutoDisabled, clearUser, getCount, MAX_IGNORED };
