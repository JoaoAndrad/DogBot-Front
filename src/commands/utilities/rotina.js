const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");
const { jidFromContact } = require("../../utils/whatsapp/getUserData");

module.exports = {
  name: "rotina",
  aliases: ["rotinas", "habito", "hábito"],
  description: "Rotinas e lembretes",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      const jid = jidFromContact(contact);
      if (jid) userId = jid;
    } catch (e) {
      logger.debug("[rotina] Erro ao obter contacto:", e.message);
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "rotina");
    } catch (err) {
      await client.sendMessage(
        chatId,
        "❌ Erro ao abrir rotinas: " + (err && err.message),
      );
    }
  },
};
