const flowManager = require("../../components/menu/flowManager");

module.exports = {
  name: "spotify",
  aliases: ["sp"],
  description: "Abrir menu Spotify",

  async execute(context) {
    const { client, message, reply } = context;
    const msg = message;
    const chatId = msg.from;
    const isGroup = chatId.endsWith("@g.us");

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

    // Se for grupo, verificar se usuário tem Spotify conectado
    if (isGroup) {
      try {
        const backendClient = require("../../services/backendClient");
        const lookupResult = await backendClient.sendToBackend(
          `/api/users/lookup`,
          { identifier: userId },
          "POST"
        );

        if (!lookupResult || !lookupResult.found || !lookupResult.hasSpotify) {
          return reply(
            "❌ Você precisa conectar sua conta Spotify primeiro!\n\n" +
              "💬 Envie */conectar* no *privado* para vincular sua conta."
          );
        }
      } catch (err) {
        console.log("[Command:spotify] Error checking Spotify:", err.message);
      }
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
