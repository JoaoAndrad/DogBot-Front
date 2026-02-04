const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

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
      // Get user WhatsApp identifier
      let whatsappId = null;
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          whatsappId = contact.id._serialized;
        }
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

      // Get user ID
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

      // Clear queue
      const response = await fetch(`${BACKEND_URL}/api/jam/${jam.id}/queue`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        return reply("❌ Erro ao limpar fila.");
      }

      const data = await response.json();
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
