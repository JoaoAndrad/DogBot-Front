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

/**
 * Lista utilizadores para o vínculo (requer actorIdentifier = admin no backend).
 */
async function getVinculoUsers(actorIdentifier) {
  if (!actorIdentifier) throw new Error("actorIdentifier é obrigatório");
  const q = encodeURIComponent(actorIdentifier);
  return sendToBackend(
    `/api/life360/vinculo-users?actorIdentifier=${q}`,
    null,
    "GET",
  );
}

/**
 * Admin atribui membro Life360 a um User (UUID).
 */
async function linkLife360ForUser(actorIdentifier, targetUserId, life360MemberId) {
  if (!actorIdentifier || !targetUserId || !life360MemberId) {
    throw new Error("actorIdentifier, targetUserId e life360MemberId são obrigatórios");
  }
  return sendToBackend(
    "/api/life360/link-user",
    { actorIdentifier, targetUserId, life360MemberId },
    "POST",
  );
}

module.exports = {
  getStatus,
  getCircles,
  getMembers,
  getGroupLinkedPreview,
  getVinculoUsers,
  linkLife360ForUser,
};
