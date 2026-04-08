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

module.exports = {
  getStatus,
  getCircles,
  getMembers,
};
