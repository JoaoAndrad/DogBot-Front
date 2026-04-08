/**
 * Cliente HTTP para a API Life360 do backend (credenciais só no servidor).
 */

const { sendToBackend } = require("./backendClient");

async function getStatus() {
  return sendToBackend("/api/life360/status", null, "GET");
}

async function getCircles() {
  const res = await sendToBackend("/api/life360/circles", null, "GET");
  return res.circles || res || [];
}

async function getMembers(circleId) {
  if (!circleId) throw new Error("circleId é obrigatório");
  const res = await sendToBackend(
    `/api/life360/circles/${encodeURIComponent(circleId)}/members`,
    null,
    "GET",
  );
  return res.members || res || [];
}

/**
 * Membros Life360 mapeados (User.life360_member_id) que participam no grupo.
 * @param {string} groupChatId - JID do grupo (@g.us)
 * @param {string[]} memberIds - JIDs dos participantes (ex.: chat.participants)
 */
async function getGroupLinkedPreview(groupChatId, memberIds) {
  const path = `/api/groups/${encodeURIComponent(groupChatId)}/life360-linked-preview`;
  return sendToBackend(path, { memberIds }, "POST");
}

module.exports = {
  getStatus,
  getCircles,
  getMembers,
  getGroupLinkedPreview,
};
