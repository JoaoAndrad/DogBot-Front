const backendClient = require("./backendClient");

async function getRoutines(chatId, editorUserId) {
  const q = new URLSearchParams({
    chatId: String(chatId),
    editorUserId: String(editorUserId),
  });
  return backendClient.sendToBackend(`/api/routines?${q.toString()}`, null, "GET");
}

async function createRoutine(payload) {
  return backendClient.sendToBackend("/api/routines", payload, "POST");
}

async function patchRoutine(id, payload) {
  return backendClient.sendToBackend(`/api/routines/${id}`, payload, "PATCH");
}

async function deleteRoutine(id, editorUserId) {
  const q = `editorUserId=${encodeURIComponent(editorUserId)}`;
  return backendClient.sendToBackend(`/api/routines/${id}?${q}`, null, "DELETE");
}

async function postponeRoutine(id, editorUserId, localDate) {
  return backendClient.sendToBackend(`/api/routines/${id}/postpone`, {
    editorUserId,
    localDate,
  }, "POST");
}

async function completeRoutineToday(id, editorUserId) {
  return backendClient.sendToBackend(
    `/api/routines/${id}/complete-today`,
    { editorUserId },
    "POST",
  );
}

async function setActiveCheckinPoll(occurrenceId, pollId) {
  return backendClient.sendToBackend("/api/routines/active-poll", {
    occurrenceId,
    pollId,
  }, "POST");
}

async function routineTick(nowIso) {
  return backendClient.sendToBackend(
    "/api/internal/routines/tick",
    nowIso ? { now: nowIso } : {},
    "POST",
  );
}

async function routineTickAck(dispatchIds, waMessageIds) {
  return backendClient.sendToBackend(
    "/api/internal/routines/tick/ack",
    { dispatchIds, waMessageIds },
    "POST",
  );
}

module.exports = {
  getRoutines,
  createRoutine,
  patchRoutine,
  deleteRoutine,
  completeRoutineToday,
  postponeRoutine,
  setActiveCheckinPoll,
  routineTick,
  routineTickAck,
};
