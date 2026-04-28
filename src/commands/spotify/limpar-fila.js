const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const {
  jidFromContact,
  lookupByIdentifier,
} = require("../../utils/whatsapp/getUserData");

module.exports = {
  name: "limpar-fila",
  aliases: ["limparfila", "clear-queue", "clear"],
  description: "Limpa a fila colaborativa (apenas host)",
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
      let whatsappId = null;
      try {
        const contact = await msg.getContact();
        whatsappId =
          jidFromContact(contact) ||
          (contact && contact.id && contact.id._serialized) ||
          null;
      } catch (err) {
        logger.error("[LimparFilaCommand] Could not resolve contact:", err);
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

      let userId;
      try {
        const lookup = await lookupByIdentifier(whatsappId);
        if (!lookup || !lookup.found || !lookup.userId) {
          return reply(
            "❌ Não encontrámos o teu usuário no sistema. Usa /cadastro ou associa a conta.",
          );
        }
        userId = lookup.userId;
      } catch (e) {
        logger.error("[LimparFilaCommand] Erro ao resolver usuário:", e);
        return reply("❌ Erro ao buscar usuário.");
      }

      // Clear queue
      let data;
      try {
        data = await backendClient.sendToBackend(
          `/api/jam/${jam.id}/queue`,
          { userId },
          "DELETE",
        );
      } catch (e) {
        logger.error("[LimparFilaCommand] Erro ao limpar fila:", e);
        // Prefer backend-provided message when available
        const backendMsg =
          (e && e.body && (e.body.message || e.body.error)) ||
          e.message ||
          "Erro ao limpar fila.";
        return reply(`❌ ${backendMsg}`);
      }

      if (!data.success) {
        return reply(`❌ ${data.message || data.error}`);
      }

      const deletedCount = data.deletedCount;

      return reply(
        `✅ *Fila limpa!*\n\n` +
          `🗑️ ${deletedCount} ${deletedCount === 1 ? "música removida" : "músicas removidas"}.`,
      );
    } catch (err) {
      logger.error("[LimparFilaCommand] Error clearing queue:", err);
      return reply(
        "❌ Erro ao limpar fila. Tente novamente em alguns instantes.",
      );
    }
  },
};
