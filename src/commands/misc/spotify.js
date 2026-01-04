const flowManager = require("../../components/menu/flowManager");

module.exports = {
  name: "spotify",
  aliases: ["sp"],
  description: "Abrir menu Spotify",

  async execute(context) {
    const { client, message } = context;
    const msg = message;
    const chatId = msg.from;

    // Usar getContact() para obter o número real (@c.us)
    let userId = msg.author || msg.from;
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        userId = contact.id._serialized;
      }
    } catch (err) {
      console.log("[Command:spotify] Error getting contact:", err.message);
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "spotify");
    } catch (err) {
      console.log("[Command:spotify] Error starting flow:", err);
      await client.sendMessage(
        chatId,
        "❌ Erro ao iniciar menu Spotify: " + err.message
      );
    }
  },
};
