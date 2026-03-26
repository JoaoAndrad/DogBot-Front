/**
 * Ponto de integração: o handler principal de mensagens de texto do bot deve chamar
 * `handleIncomingTextMessage` antes de tratar o texto como comando livre, para que
 * o fluxo film-card possa receber datas (ajuste de visualização).
 */

const flowManager = require("./flowManager");

/**
 * @returns {Promise<boolean>} true se a mensagem foi tratada (não propagar)
 */
async function handleIncomingTextMessage(client, chatId, userId, text) {
  return flowManager.handleOptionalTextMessage(client, chatId, userId, text);
}

module.exports = { handleIncomingTextMessage };
