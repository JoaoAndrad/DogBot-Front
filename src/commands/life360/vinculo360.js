const flowManager = require("../../components/menu/flowManager");

module.exports = {
  name: "vinculo360",
  aliases: ["link360", "mapear360"],
  description:
    "Vincular a sua conta do bot a um membro Life360 (só no privado com o bot)",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup =
      !!(message && message.isGroup) ||
      (chatId && chatId.endsWith("@g.us"));
    if (isGroup) {
      await client.sendMessage(
        chatId,
        "⚠️ O comando /vinculo360 só pode ser usado no *privado* com o bot, para associar a *sua* conta Life360 de forma segura.",
      );
      return;
    }

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
      await flowManager.startFlow(client, chatId, userId, "vinculo360", {
        initialContext: { waIdentifier: userId },
      });
    } catch (err) {
      await client.sendMessage(
        chatId,
        "❌ Erro ao abrir vínculo Life360: " + (err && err.message),
      );
    }
  },
};
