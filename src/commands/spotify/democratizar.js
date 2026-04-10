const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "democratizar",
  aliases: ["colaborativo", "colab", "democratica", "colaborativa"],
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
      const jamsRes = await backendClient.sendToBackend(
        `/api/jam/active?chatId=${chatId}`,
        null,
        "GET",
      );

      if (!jamsRes.success || !jamsRes.jams || jamsRes.jams.length === 0) {
        return reply("❌ Não há jam ativa neste grupo.");
      }

      const jam = jamsRes.jams[0];

      // Resolver utilizador pelo mesmo endpoint que o resto da API (fallbacks @c.us / @lid / número base)
      let userData;
      try {
        userData = await backendClient.sendToBackend(
          `/api/users/by-identifier/${encodeURIComponent(whatsappId)}`,
          null,
          "GET",
        );
      } catch (lookupErr) {
        if (lookupErr.status === 404) {
          logger.warn(
            "[DemocratizarCommand] Utilizador não encontrado no backend (by-identifier)",
          );
          return reply(
            "❌ Não encontrámos o teu utilizador no sistema. Interage com o bot ou associa a conta para sincronizar.",
          );
        }
        logger.error(
          "[DemocratizarCommand] Erro ao resolver utilizador:",
          lookupErr,
        );
        return reply("❌ Erro ao buscar usuário.");
      }

      if (!userData.success || !userData.user) {
        logger.warn(
          "[DemocratizarCommand] Resposta inesperada ao resolver utilizador",
          userData,
        );
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

      let updateData;
      try {
        updateData = await backendClient.sendToBackend(
          `/api/jam/${jam.id}`,
          { jamType: newType },
          "PATCH",
        );
      } catch (patchErr) {
        logger.error("[DemocratizarCommand] Erro ao atualizar jam:", patchErr);
        return reply("❌ Erro ao atualizar jam.");
      }

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
