/**
 * Ponto de integração: o handler principal de mensagens de texto do bot deve chamar
 * `handleIncomingTextMessage` antes de tratar o texto como comando livre, para que
 * o fluxo film-card possa receber datas (ajuste de visualização).
 *
 * 1) conversationState (in-memory, como list-creation): após "Sim" na enquete de data,
 *    regista aliases (UUID + chatId @c.us) para o processador encontrar o fluxo mesmo
 *    quando só passa um dos ids.
 * 2) handleOptionalTextMessage: lê /api/menu/state e confirma a data.
 */

const flowManager = require("./flowManager");
const conversationState = require("../../services/conversationState");

/**
 * Se há espera de data registada em conversationState, força o userId do storage do menu.
 * @returns {Promise<boolean>}
 */
async function tryFilmViewingDateFromConversation(client, chatId, userId, text) {
  const candidates = [userId, chatId].filter(Boolean);
  let conv = null;
  for (const k of [...new Set(candidates)]) {
    const s = conversationState.getState(k);
    if (s?.flowType === "film-viewing-date") {
      conv = s;
      break;
    }
  }
  if (!conv) return false;
  const storageUserId = conv.data && conv.data.filmCardStorageUserId;
  if (!storageUserId) {
    conversationState.clearState(userId);
    return false;
  }
  return flowManager.handleOptionalTextMessage(
    client,
    chatId,
    storageUserId,
    text,
  );
}

/**
 * @returns {Promise<boolean>} true se a mensagem foi tratada (não propagar)
 */
async function handleIncomingTextMessage(client, chatId, userId, text) {
  const fromConv = await tryFilmViewingDateFromConversation(
    client,
    chatId,
    userId,
    text,
  );
  if (fromConv) return true;
  return flowManager.handleOptionalTextMessage(client, chatId, userId, text);
}

module.exports = { handleIncomingTextMessage };
