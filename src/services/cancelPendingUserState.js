/**
 * Cancela todos os fluxos pendentes do Usuário: conversationState (memória)
 * e registos MenuState no backend (flows de menu / enquetes).
 */

const conversationState = require("./conversationState");
const flowManager = require("../components/menu/flowManager");
const storage = require("../components/menu/storage");
const resolveUserUuidForMenu = require("../utils/whatsapp/resolveUserUuidForMenu");

function normalizeCmdName(s) {
  if (!s) return "";
  try {
    return String(s)
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  } catch (e) {
    return String(s).trim().toLowerCase();
  }
}

/**
 * Mensagem inteira = Cancelar | /cancelar | !cancelar (após normalizar o núcleo).
 */
function isGlobalCancelMessage(body) {
  const t = String(body || "").trim();
  if (!t) return false;
  let core = t;
  if (core.startsWith("/")) core = core.slice(1);
  else if (core.startsWith("!")) core = core.slice(1);
  return normalizeCmdName(core) === "cancelar";
}

function isGroupJid(id) {
  return id && String(id).endsWith("@g.us");
}

/**
 * @param {object} p
 * @param {string} [p.flowUserId]
 * @param {string} [p.actualNumber]
 * @param {string} [p.author]
 * @param {string} [p.dbUserId]
 * @returns {Promise<string[]>}
 */
async function collectCandidateUserIds({
  flowUserId,
  actualNumber,
  author,
  dbUserId,
}) {
  const raw = [flowUserId, actualNumber, author, dbUserId].filter(Boolean);
  const out = new Set();
  for (const id of raw) {
    if (isGroupJid(id)) continue;
    out.add(String(id));
  }
  for (const id of [...out]) {
    const uuid = await resolveUserUuidForMenu(id);
    if (uuid) out.add(uuid);
  }
  return [...out];
}

/**
 * @returns {Promise<{ cleared: boolean }>}
 */
async function cancelPendingForUser({
  flowUserId,
  actualNumber,
  author,
  dbUserId,
}) {
  const ids = await collectCandidateUserIds({
    flowUserId,
    actualNumber,
    author,
    dbUserId,
  });
  let cleared = false;

  for (const id of ids) {
    if (conversationState.hasActiveFlow(id)) {
      conversationState.clearState(id);
      cleared = true;
    }
  }

  const seenEndFlow = new Set();
  for (const userId of ids) {
    let list;
    try {
      list = await storage.listStates(userId);
    } catch (e) {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const fid = row && row.flowId;
      if (!fid) continue;
      const key = `${userId}::${fid}`;
      if (seenEndFlow.has(key)) continue;
      seenEndFlow.add(key);
      try {
        await flowManager.endFlow(userId, fid);
        cleared = true;
      } catch (e) {
        /* ignore */
      }
    }
  }

  return { cleared };
}

module.exports = {
  isGlobalCancelMessage,
  cancelPendingForUser,
  collectCandidateUserIds,
};
