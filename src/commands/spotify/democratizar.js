const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

module.exports = {
  name: "democratizar",
  aliases: ["colaborativo", "colab"],
  description: "Alterna entre modo clássico e colaborativo da jam",
  category: "spotify",
  requiredArgs: 0,

  async execute(ctx) {
    const { message, reply, client } = ctx;
    const msg = message;
    const chatId = msg.from;

    // Check if is group
    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));

    if (!isGroup) {
      return reply("⚠️ Este comando só funciona em grupos com jam ativa.");
    }

    try {
      // Get user WhatsApp identifier
      let whatsappId = null;
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          whatsappId = contact.id._serialized;
        }
      } catch (err) {
        logger.error("[DemocratizarCommand] Could not resolve contact:", err);
      }

      if (!whatsappId) {
        return reply("⚠️ Não foi possível identificar o usuário.");
      }

      // Get active jam for this group
      const jamsRes = await backendClient.get(
        `/api/jam/active?chatId=${chatId}`,
      );

      if (!jamsRes.success || !jamsRes.jams || jamsRes.jams.length === 0) {
        return reply("❌ Não há jam ativa neste grupo.");
      }

      const jam = jamsRes.jams[0];

      // Get user from backend
      const senderNumber = whatsappId.replace("@c.us", "");
      const userResponse = await fetch(
        `${BACKEND_URL}/api/users/by-sender-number/${senderNumber}`,
      );

      if (!userResponse.ok) {
        return reply("❌ Erro ao buscar usuário.");
      }

      const userData = await userResponse.json();
      if (!userData.success) {
        return reply("❌ Erro ao buscar usuário.");
      }

      const userId = userData.user.id;

      // Check if user is host
      if (jam.hostUserId !== userId) {
        return reply("❌ Apenas o host pode mudar o modo da jam.");
      }

      // Toggle jam type
      const newType =
        jam.jamType === "collaborative" ? "classic" : "collaborative";

      const updateResponse = await fetch(`${BACKEND_URL}/api/jam/${jam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jamType: newType }),
      });

      if (!updateResponse.ok) {
        return reply("❌ Erro ao atualizar jam.");
      }

      const updateData = await updateResponse.json();
      if (!updateData.success) {
        return reply(
          `❌ Erro ao atualizar jam: ${updateData.message || updateData.error}`,
        );
      }

      if (newType === "collaborative") {
        return reply(
          "🎉 *JAM DEMOCRATIZADA!*\n\n" +
            "✅ Modo colaborativo ativado!\n\n" +
            "Agora todos podem adicionar músicas à fila usando:\n" +
            "*/adicionar <música>*\n\n" +
            "As músicas precisam de aprovação dos participantes para entrar na fila.\n\n" +
            "Use */fila* para ver a fila.",
        );
      } else {
        return reply(
          "🎵 *JAM CLÁSSICA*\n\n" +
            "✅ Modo clássico ativado!\n\n" +
            "Apenas o host pode controlar a reprodução.\n\n" +
            "A fila colaborativa foi mantida mas não será reproduzida automaticamente.",
        );
      }
    } catch (err) {
      logger.error("[DemocratizarCommand] Error toggling jam mode:", err);
      return reply(
        "❌ Erro ao mudar modo da jam. Tente novamente em alguns instantes.",
      );
    }
  },
};
