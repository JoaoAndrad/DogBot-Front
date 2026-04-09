const flowManager = require("../../components/menu/flowManager");

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
      if (contact && contact.id && contact.id._serialized) {
        userId = contact.id._serialized;
      }
    } catch (e) {
      /* ignore */
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
