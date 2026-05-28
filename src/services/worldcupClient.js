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

async function getNextMatches(limit = 5) {
  return backendClient.sendToBackend(`/api/worldcup/matches/upcoming?limit=${limit}`, null, "GET");
}

async function getMatchesToday() {
  return backendClient.sendToBackend("/api/worldcup/matches/today", null, "GET");
}

// ─── Standings ───────────────────────────────────────────────────────────────

async function getStandings(group) {
  const q = group ? `?group=${encodeURIComponent(group)}` : "";
  return backendClient.sendToBackend(`/api/worldcup/standings${q}`, null, "GET");
}

// ─── Predictions ─────────────────────────────────────────────────────────────

async function submitPrediction(userId, matchId, predictedHome, predictedAway) {
  return backendClient.sendToBackend("/api/worldcup/predictions", { userId, matchId, predictedHome, predictedAway }, "POST");
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

// ─── Internal tick ───────────────────────────────────────────────────────────

async function worldCupTick(nowIso) {
  return backendClient.sendToBackend("/api/internal/worldcup/tick", nowIso ? { now: nowIso } : {}, "POST");
}

async function goalPoll(matchId, homeScore, awayScore) {
  return backendClient.sendToBackend("/api/internal/worldcup/goal-poll", { matchId, homeScore, awayScore }, "POST");
}

async function syncData() {
  return backendClient.sendToBackend("/api/internal/worldcup/sync", {}, "POST");
}

module.exports = {
  getNextMatches,
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
};
