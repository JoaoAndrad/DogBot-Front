"use strict";

const backendClient = require("./backendClient");

// ─── Rodada ───────────────────────────────────────────────────────────────────

async function getRodada() {
  return backendClient.sendToBackend("/api/cartola/rodada", null, "GET");
}

// ─── Time do usuário ─────────────────────────────────────────────────────────

async function getUserTeam(userId) {
  return backendClient.sendToBackend(`/api/cartola/team/${encodeURIComponent(userId)}`, null, "GET");
}

async function saveUserTeam(userId, slug) {
  return backendClient.sendToBackend("/api/cartola/team", { userId, slug }, "POST");
}

async function getMyTeamData(userId) {
  return backendClient.sendToBackend(`/api/cartola/team/${encodeURIComponent(userId)}/data`, null, "GET");
}

// ─── Liga do grupo ────────────────────────────────────────────────────────────

async function getGroupLeague(groupId) {
  return backendClient.sendToBackend(`/api/cartola/league/${encodeURIComponent(groupId)}`, null, "GET");
}

async function saveGroupLeague(groupId, slug, linkedBy) {
  return backendClient.sendToBackend("/api/cartola/league", { groupId, slug, linkedBy }, "POST");
}

async function removeGroupLeague(groupId) {
  return backendClient.sendToBackend(`/api/cartola/league/${encodeURIComponent(groupId)}`, null, "DELETE");
}

async function getLeagueRanking(groupId) {
  return backendClient.sendToBackend(`/api/cartola/league/${encodeURIComponent(groupId)}/ranking`, null, "GET");
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getAuthLink(userId) {
  const { sessionUuid } = await backendClient.sendToBackend("/api/cartola/auth/link", { userId }, "POST");
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  return { link: `${backendUrl}/cartola/login?session=${sessionUuid}` };
}

async function getAuthStatus(userId) {
  return backendClient.sendToBackend(`/api/cartola/auth/status/${encodeURIComponent(userId)}`, null, "GET");
}

async function disconnectAuth(userId) {
  return backendClient.sendToBackend(`/api/cartola/auth/${encodeURIComponent(userId)}`, null, "DELETE");
}

async function getAuthTimeData(userId) {
  return backendClient.sendToBackend(`/api/cartola/auth/time/${encodeURIComponent(userId)}`, null, "GET");
}

async function getAuthLigas(userId) {
  return backendClient.sendToBackend(`/api/cartola/auth/ligas/${encodeURIComponent(userId)}`, null, "GET");
}

module.exports = {
  getRodada,
  getUserTeam,
  saveUserTeam,
  getMyTeamData,
  getGroupLeague,
  saveGroupLeague,
  removeGroupLeague,
  getLeagueRanking,
  getAuthLink,
  getAuthStatus,
  disconnectAuth,
  getAuthTimeData,
  getAuthLigas,
};
