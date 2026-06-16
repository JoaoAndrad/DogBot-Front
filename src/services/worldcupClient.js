"use strict";

const backendClient = require("./backendClient");

// ─── Group activation ────────────────────────────────────────────────────────

async function activateGroup(groupId, activatedByUserId) {
  return backendClient.sendToBackend(`/api/worldcup/groups/${encodeURIComponent(groupId)}/activate`, { activatedByUserId }, "POST");
}

async function deactivateGroup(groupId) {
  return backendClient.sendToBackend(`/api/worldcup/groups/${encodeURIComponent(groupId)}/deactivate`, {}, "POST");
}

async function getGroupSettings(groupId) {
  return backendClient.sendToBackend(`/api/worldcup/groups/${encodeURIComponent(groupId)}/settings`, null, "GET");
}

async function updateGroupSettings(groupId, updates) {
  return backendClient.sendToBackend(`/api/worldcup/groups/${encodeURIComponent(groupId)}/settings`, updates, "PATCH");
}

// ─── Matches ─────────────────────────────────────────────────────────────────

async function getNextMatch() {
  return backendClient.sendToBackend("/api/worldcup/matches/next", null, "GET");
}

async function getNextMatches(limit = 5, offset = 0) {
  return backendClient.sendToBackend(`/api/worldcup/matches/upcoming?limit=${limit}&offset=${offset}`, null, "GET");
}

async function getMatchesToday() {
  return backendClient.sendToBackend("/api/worldcup/matches/today", null, "GET");
}

// ─── Standings ───────────────────────────────────────────────────────────────

async function getStandings(group) {
  const q = group ? `?group=${encodeURIComponent(group)}` : "";
  return backendClient.sendToBackend(`/api/worldcup/standings${q}`, null, "GET");
}

async function getStandingsGrouped(group) {
  const q = group ? `?group=${encodeURIComponent(group)}` : "";
  return backendClient.sendToBackend(`/api/worldcup/standings/grouped${q}`, null, "GET");
}

// ─── Predictions ─────────────────────────────────────────────────────────────

async function submitPrediction(userId, matchId, predictedHome, predictedAway, advancingTeam) {
  return backendClient.sendToBackend("/api/worldcup/predictions", { userId, matchId, predictedHome, predictedAway, advancingTeam: advancingTeam || null }, "POST");
}

async function getUserPredictions(userId) {
  return backendClient.sendToBackend(`/api/worldcup/predictions/${encodeURIComponent(userId)}`, null, "GET");
}

async function userHasActiveGroup(userId, groupIds) {
  return backendClient.sendToBackend("/api/worldcup/predictions/has-active-group", { userId, groupIds }, "POST");
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

async function getLeaderboard(groupId, userIds) {
  return backendClient.sendToBackend("/api/worldcup/leaderboard", { groupId, userIds }, "POST");
}

async function getWeeklyLeaderboard(groupId, userIds) {
  return backendClient.sendToBackend("/api/worldcup/leaderboard/weekly", { groupId, userIds }, "POST");
}

// ─── Bolão ────────────────────────────────────────────────────────────────────

async function getBolao(groupId) {
  return backendClient.sendToBackend(`/api/worldcup/bolao/${encodeURIComponent(groupId)}`, null, "GET");
}

async function createBolao(groupId, senderNumbers, { name, createdBy } = {}) {
  return backendClient.sendToBackend("/api/worldcup/bolao", { groupId, senderNumbers, name, createdBy }, "POST");
}

// ─── Internal tick ───────────────────────────────────────────────────────────

async function setDmAlerts(userId, enabled) {
  return backendClient.sendToBackend(`/api/worldcup/users/${encodeURIComponent(userId)}/dm-alerts`, { enabled }, "PATCH");
}

async function worldCupTick(nowIso) {
  return backendClient.sendToBackend("/api/internal/worldcup/tick", nowIso ? { now: nowIso } : {}, "POST");
}

async function goalPoll(matchId, homeScore, awayScore) {
  return backendClient.sendToBackend("/api/internal/worldcup/goal-poll", { matchId, homeScore, awayScore }, "POST");
}

async function syncData() {
  return backendClient.sendToBackend("/api/internal/worldcup/sync", {}, "POST");
}

async function triggerWeeklySummary() {
  return backendClient.sendToBackend("/api/internal/worldcup/weekly-summary", {}, "POST");
}

async function submitZebraPrediction(userId, team) {
  return backendClient.sendToBackend("/api/worldcup/predictions/zebra", { userId, team }, "POST");
}
async function getZebraPrediction(userId) {
  return backendClient.sendToBackend(`/api/worldcup/predictions/zebra/${encodeURIComponent(userId)}`, null, "GET");
}
async function submitMvpPrediction(userId, playerName) {
  return backendClient.sendToBackend("/api/worldcup/predictions/mvp", { userId, playerName }, "POST");
}
async function getMvpPrediction(userId) {
  return backendClient.sendToBackend(`/api/worldcup/predictions/mvp/${encodeURIComponent(userId)}`, null, "GET");
}

async function submitChampionPrediction(userId, team) {
  return backendClient.sendToBackend("/api/worldcup/predictions/champion", { userId, team }, "POST");
}

async function getChampionPrediction(userId) {
  return backendClient.sendToBackend(`/api/worldcup/predictions/champion/${encodeURIComponent(userId)}`, null, "GET");
}

module.exports = {
  getNextMatches,
  getStandingsGrouped,
  submitChampionPrediction,
  getChampionPrediction,
  submitZebraPrediction,
  getZebraPrediction,
  submitMvpPrediction,
  getMvpPrediction,
  activateGroup,
  deactivateGroup,
  getGroupSettings,
  updateGroupSettings,
  getNextMatch,
  getMatchesToday,
  getStandings,
  submitPrediction,
  getUserPredictions,
  userHasActiveGroup,
  getLeaderboard,
  getWeeklyLeaderboard,
  worldCupTick,
  goalPoll,
  syncData,
  getBolao,
  createBolao,
  setDmAlerts,
};
