const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "trancar",
  aliases: ["trancado", "lock"],
  description: "Trancar a jam (impede que outros usuários adicionem músicas)",
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
        logger.error("[TracarCommand] Could not resolve contact:", err);
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

      // Resolve user by the same endpoint as the rest of the API
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
            "[TracarCommand] usuário não encontrado no backend (by-identifier)",
          );
          return reply(
            "❌ Não encontrámos o teu usuário no sistema. Interage com o bot ou associa a conta para sincronizar.",
          );
        }
        logger.error("[TracarCommand] Erro ao resolver usuário:", lookupErr);
        return reply("❌ Erro ao buscar usuário.");
      }

      if (!userData.success || !userData.user) {
        logger.warn(
          "[TracarCommand] Resposta inesperada ao resolver usuário",
          userData,
        );
        return reply("❌ Erro ao buscar usuário.");
      }

      const userId = userData.user.id;

      // Check if user is host
      if (jam.hostUserId !== userId) {
        return reply("❌ Apenas o host pode trancar/destrancara jam.");
      }

      // Toggle jam type
      const newType = jam.jamType === "classic" ? "collaborative" : "classic";

      let updateData;
      try {
        updateData = await backendClient.sendToBackend(
          `/api/jam/${jam.id}`,
          { jamType: newType },
          "PATCH",
        );
      } catch (patchErr) {
        logger.error("[TracarCommand] Erro ao atualizar jam:", patchErr);
        return reply("❌ Erro ao atualizar jam.");
      }

      if (!updateData.success) {
        return reply(
          `❌ Erro ao atualizar jam: ${updateData.message || updateData.error}`,
        );
      }

      if (newType === "classic") {
        return reply(
          "🔒 *JAM TRANCADA!*\n\n" +
            "✅ Modo clássico ativado!\n\n" +
            "Apenas você pode controlar a música. Outros usuários não podem usar */adicionar*.\n\n" +
            "Use */destrancar* para permitir adições novamente.",
        );
      } else {
        return reply(
          "🔓 *JAM DESTRANCADA!*\n\n" +
            "✅ Modo colaborativo ativado!\n\n" +
            "Agora todos podem adicionar músicas à fila usando:\n" +
            "*/adicionar <música>*\n\n" +
            "As músicas precisam de aprovação dos participantes para entrar na fila.\n\n" +
            "Use */fila* para ver a fila.",
        );
      }
    } catch (err) {
      logger.error("[TracarCommand] Error toggling jam mode:", err);
      return reply(
        "❌ Erro ao trancar/destrancar a jam. Tente novamente em alguns instantes.",
      );
    }
  },
};
