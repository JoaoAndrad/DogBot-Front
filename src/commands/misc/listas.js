/**
 * commands/misc/listas.js — Comando para gerenciar listas de filmes/séries
 * Uso: .listas
 */

const flowManager = require("../../components/menu/flowManager");

module.exports = {
  name: "listas",
  aliases: ["lista", "movies", "filmes", "séries"],
  description: "📋 Gerenciar listas de filmes e livros",

  async execute(context) {
    const { client, message, reply } = context;
    const msg = message;
    const chatId = msg.from;

    // Obter user ID
    let userId = msg.author || msg.from;
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        userId = contact.id._serialized;
      }
    } catch (err) {
      console.log("[Command:listas] Error getting contact:", err.message);
    }

    try {
      // Iniciar flow de listas
      await flowManager.startFlow(client, chatId, userId, "lists");
    } catch (err) {
      console.log("[Command:listas] Error starting flow:", err);
      await client.sendMessage(
        chatId,
        "❌ Erro ao abrir menu de listas.\n\n" + "Tente novamente mais tarde.",
      );
    }
  },
};
