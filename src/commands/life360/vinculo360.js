const flowManager = require("../../components/menu/flowManager");
const life360Client = require("../../services/life360Client");

module.exports = {
  name: "vinculo360",
  aliases: ["link360", "mapear360"],
  description:
    "[Admin] Vincular membro Life360 a um utilizador do bot (só no privado)",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup =
      !!(message && message.isGroup) ||
      (chatId && chatId.endsWith("@g.us"));
    if (isGroup) {
      await client.sendMessage(
        chatId,
        "⚠️ O comando /vinculo360 só pode ser usado no *privado* com o bot.",
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
      await life360Client.getVinculoUsers(userId, "");
    } catch (e) {
      if (e.status === 403) {
        await client.sendMessage(
          chatId,
          "⚠️ Apenas *administradores* do bot podem usar /vinculo360.",
        );
        return;
      }
      await client.sendMessage(
        chatId,
        "❌ " + (e.message || String(e)),
      );
      return;
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "vinculo360", {
        initialContext: { adminWaIdentifier: userId },
      });
    } catch (err) {
      await client.sendMessage(
        chatId,
        "❌ Erro ao abrir vínculo Life360: " + (err && err.message),
      );
    }
  },
};
