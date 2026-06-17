"use strict";

const backendClient = require("./backendClient");

// ─── Rodada ───────────────────────────────────────────────────────────────────

async function getRodada(tipo = "brasileirao") {
  const q = tipo !== "brasileirao" ? `?tipo=${encodeURIComponent(tipo)}` : "";
  return backendClient.sendToBackend(`/api/cartola/rodada${q}`, null, "GET");
}

// ─── Time do usuário ─────────────────────────────────────────────────────────

async function getUserTeam(userId, tipo = "brasileirao") {
  return backendClient.sendToBackend(`/api/cartola/team/${encodeURIComponent(userId)}?tipo=${encodeURIComponent(tipo)}`, null, "GET");
}

async function getAllUserTeams(userId) {
  return backendClient.sendToBackend(`/api/cartola/team/${encodeURIComponent(userId)}/all`, null, "GET");
}

async function saveUserTeam(userId, slug, tipo = "brasileirao") {
  return backendClient.sendToBackend("/api/cartola/team", { userId, slug, tipo }, "POST");
}

async function getMyTeamData(userId, tipo = "brasileirao") {
  return backendClient.sendToBackend(`/api/cartola/team/${encodeURIComponent(userId)}/data?tipo=${encodeURIComponent(tipo)}`, null, "GET");
}

// ─── Liga do grupo ────────────────────────────────────────────────────────────

async function getGroupLeague(groupId) {
  return backendClient.sendToBackend(`/api/cartola/league/${encodeURIComponent(groupId)}`, null, "GET");
}

async function saveGroupLeague(groupId, slug, linkedBy, tipo) {
  return backendClient.sendToBackend("/api/cartola/league", { groupId, slug, linkedBy, tipo }, "POST");
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

async function getGroupParcial(groupId, tipo = "brasileirao") {
  const qs = tipo !== "brasileirao" ? `?tipo=${encodeURIComponent(tipo)}` : "";
  return backendClient.sendToBackend(`/api/cartola/group/${encodeURIComponent(groupId)}/parcial${qs}`, null, "GET");
}

async function getCopaActiveGroups() {
  return backendClient.sendToBackend("/api/cartola/copa-groups", null, "GET");
}

async function getCopaGroupTeams(groupId, userId = null) {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return backendClient.sendToBackend(`/api/cartola/group/${encodeURIComponent(groupId)}/copa-teams${qs}`, null, "GET");
}

async function getGroupJogandoAgora(groupId) {
  return backendClient.sendToBackend(`/api/cartola/group/${encodeURIComponent(groupId)}/jogando`, null, "GET");
}

async function getGroupSettings(groupId) {
  return backendClient.sendToBackend(`/api/cartola/group/${encodeURIComponent(groupId)}/settings`, null, "GET");
}

async function saveGroupSettings(groupId, data) {
  return backendClient.sendToBackend(`/api/cartola/group/${encodeURIComponent(groupId)}/settings`, data, "POST");
}

module.exports = {
  getRodada,
  getUserTeam,
  getAllUserTeams,
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
  getGroupParcial,
  getGroupSettings,
  saveGroupSettings,
  getCopaActiveGroups,
  getCopaGroupTeams,
  getGroupJogandoAgora,
};
