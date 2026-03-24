const flowManager = require("../../components/menu/flowManager");
const testFlow = require("../../components/menu/flows/testFlow");
const spotifyFlow = require("../../components/menu/flows/spotifyFlow");
const listsFlow = require("../../components/menu/flows/listsFlow");
const addFilmFlow = require("../../components/menu/flows/addFilmFlow");
const filmCardFlow = require("../../components/menu/flows/filmCardFlow");
const filmSearchFlow = require("../../components/menu/flows/filmSearchFlow");
const bookCardFlow = require("../../components/menu/flows/bookCardFlow");
const bookSearchFlow = require("../../components/menu/flows/bookSearchFlow");
const addBookFlow = require("../../components/menu/flows/addBookFlow");

// Register flows on load
flowManager.registerFlow(testFlow);
flowManager.registerFlow(spotifyFlow);
flowManager.registerFlow(listsFlow);
flowManager.registerFlow(addFilmFlow);
flowManager.registerFlow(addBookFlow);
flowManager.registerFlow(filmCardFlow);
flowManager.registerFlow(filmSearchFlow);
flowManager.registerFlow(bookCardFlow);
flowManager.registerFlow(bookSearchFlow);

module.exports = {
  name: "menu",
  aliases: ["m"],
  description: "Menu interativo de teste",

  async execute(context) {
    const { client, message } = context;
    const msg = message; // Compatibilidade
    const chatId = msg.from;

    // Usar getContact() para obter o número real (@c.us)
    let userId = msg.author || msg.from;
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        userId = contact.id._serialized;
      }
    } catch (err) {
      console.log("[Command:menu] Error getting contact:", err.message);
    }

    console.log("[Command:menu] Starting flow for", { userId, chatId });
    console.log("[Command:menu] FlowManager available?", !!flowManager);
    console.log("[Command:menu] Client available?", !!client);

    try {
      await flowManager.startFlow(client, chatId, userId, "test");
      console.log("[Command:menu] Flow started successfully");
    } catch (err) {
      console.log("[Command:menu] Error starting flow:", err);
      console.log("[Command:menu] Error stack:", err.stack);
      await client.sendMessage(
        chatId,
        "❌ Erro ao iniciar menu: " + err.message,
      );
    }
  },
};
