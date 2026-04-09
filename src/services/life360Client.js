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

/** Detalhe de um membro (GET Member na API Life360). */
async function getMember(circleId, memberId) {
  if (!circleId || !memberId)
    throw new Error("circleId e memberId são obrigatórios");
  return sendToBackend(
    `/api/life360/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(memberId)}`,
    null,
    "GET",
  );
}

/**
 * Descobre o círculo do membro e devolve membro completo (quando o fluxo só tem memberId, ex. voto via processador).
 */
async function resolveLife360Member(memberId) {
  if (!memberId) throw new Error("memberId é obrigatório");
  return sendToBackend(
    `/api/life360/resolve-member/${encodeURIComponent(memberId)}`,
    null,
    "GET",
  );
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
 * Lista Usuários para o vínculo (requer actorIdentifier = admin no backend).
 * @param {string} [memberHint] — nome do membro Life360 para ordenar por match (push_name/display_name).
 */
async function getVinculoUsers(actorIdentifier, memberHint) {
  if (!actorIdentifier) throw new Error("actorIdentifier é obrigatório");
  let path = `/api/life360/vinculo-users?actorIdentifier=${encodeURIComponent(actorIdentifier)}`;
  if (memberHint && String(memberHint).trim()) {
    path += `&memberHint=${encodeURIComponent(String(memberHint).trim())}`;
  }
  return sendToBackend(path, null, "GET");
}

/**
 * Admin atribui membro Life360 a um User (UUID).
 */
async function linkLife360ForUser(
  actorIdentifier,
  targetUserId,
  life360MemberId,
) {
  if (!actorIdentifier || !targetUserId || !life360MemberId) {
    throw new Error(
      "actorIdentifier, targetUserId e life360MemberId são obrigatórios",
    );
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
  getMember,
  resolveLife360Member,
  getGroupLinkedPreview,
  getVinculoUsers,
  linkLife360ForUser,
};
