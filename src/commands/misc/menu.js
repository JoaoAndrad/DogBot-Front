const flowManager = require("../../components/menu/flowManager");
const testFlow = require("../../components/menu/flows/testFlow");
const spotifyFlow = require("../../components/menu/flows/spotifyFlow");

// Register flows on load
flowManager.registerFlow(testFlow);
flowManager.registerFlow(spotifyFlow);

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
        "❌ Erro ao iniciar menu: " + err.message
      );
    }
  },
};
