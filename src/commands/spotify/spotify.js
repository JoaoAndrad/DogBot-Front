const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");
const {
  jidFromContact,
  lookupByIdentifierPost,
} = require("../../utils/whatsapp/getUserData");

module.exports = {
  name: "spotify",
  aliases: ["sp"],
  description: "Abrir menu Spotify",

  async execute(context) {
    const { client, message, reply } = context;
    const msg = message;
    const chatId = msg.from;
    const isGroup = chatId.endsWith("@g.us");

    let userId = msg.author || msg.from;
    if (msg && typeof msg.getContact === "function") {
      try {
        const contact = await msg.getContact();
        const jid = jidFromContact(contact);
        if (jid) userId = jid;
      } catch (err) {
        logger.warn("[Command:spotify] Erro ao obter contacto:", err.message);
      }
    }

    // Se for grupo, verificar se usuário tem Spotify conectado
    if (isGroup) {
      try {
        const lookupResult = await lookupByIdentifierPost(userId);

        if (!lookupResult || !lookupResult.found || !lookupResult.hasSpotify) {
          return reply(
            "❌ Você precisa conectar sua conta Spotify primeiro!\n\n" +
              "💬 Envie */conectar* no *privado* para vincular sua conta."
          );
        }
      } catch (err) {
        logger.warn("[Command:spotify] Erro ao verificar Spotify:", err.message);
      }
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "spotify");
    } catch (err) {
      logger.warn("[Command:spotify] Erro ao iniciar fluxo:", err);
      await client.sendMessage(
        chatId,
        "❌ Erro ao iniciar menu Spotify: " + err.message
      );
    }
  },
};
