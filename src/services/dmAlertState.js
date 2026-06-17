"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const STATE_FILE = path.join(DATA_DIR, "dm-alert-ignored.json");
const MAX_IGNORED = 3;

function _load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
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
 * Retorna o número total de matchIds ignorados (sem palpite) para esse usuário.
 */
function recordAlert(jid, matchId) {
  const state = _load();
  if (!state[jid]) state[jid] = [];
  if (!state[jid].includes(matchId)) state[jid].push(matchId);
  _save(state);
  return state[jid].length;
}

/**
 * Remove um matchId específico da lista de ignorados de um usuário
 * (chamado quando o usuário faz palpite para esse jogo).
 */
function clearMatchForUser(jid, matchId) {
  const state = _load();
  if (!state[jid]) return;
  state[jid] = state[jid].filter((id) => id !== matchId);
  if (!state[jid].length) delete state[jid];
  _save(state);
}

/**
 * Remove completamente o histórico de um usuário
 * (chamado quando o usuário faz qualquer palpite — fresh start).
 */
function clearUser(jid) {
  const state = _load();
  if (!state[jid]) return;
  delete state[jid];
  _save(state);
}

function getCount(jid) {
  const state = _load();
  return (state[jid] || []).length;
}

module.exports = { recordAlert, clearMatchForUser, clearUser, getCount, MAX_IGNORED };
