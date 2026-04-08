const flowManager = require("../../components/menu/flowManager");
const { resolveGroupMemberIds } = require("../../utils/whatsappParticipantIds");

module.exports = {
  name: "life360",
  aliases: ["life", "l360", "loc", "localizacao"],
  description: "Life360: localização dos membros mapeados (só em grupo)",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup =
      !!(message && message.isGroup) ||
      (chatId && chatId.endsWith("@g.us"));
    if (!isGroup) {
      await client.sendMessage(
        chatId,
        "⚠️ O comando /life360 só funciona em *grupos* WhatsApp. A localização Life360 é partilhada apenas no contexto do grupo.",
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

    let memberIds = [];
    try {
      memberIds = await resolveGroupMemberIds(client, message, chatId);
    } catch (e) {
      memberIds = [];
    }

    try {
      await flowManager.startFlow(client, chatId, userId, "life360", {
        initialContext: {
          groupChatId: chatId,
          ...(memberIds.length ? { memberIds } : {}),
        },
      });
    } catch (err) {
      await client.sendMessage(
        chatId,
        "❌ Erro ao abrir Life360: " + (err && err.message),
      );
    }
  },
};
