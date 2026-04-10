const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

/**
 * Resolve user name from WhatsApp contact
 */
async function resolveUserName(senderNumber, client) {
  if (!senderNumber || !client) return "Anônimo";

  try {
    const whatsappId = senderNumber.includes("@")
      ? senderNumber
      : `${senderNumber}@c.us`;

    const contact = await client.getContactById(whatsappId);
    return contact?.pushname || contact?.name || senderNumber;
  } catch (err) {
    return senderNumber;
  }
}

module.exports = {
  name: "fila",
  aliases: ["queue", "q"],
  description: "Mostra a fila colaborativa da jam",
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
        logger.error("[FilaCommand] Could not resolve contact:", err);
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

      // Get queue from backend
      let data;
      try {
        data = await backendClient.sendToBackend(
          `/api/jam/${jam.id}/queue`,
          null,
          "GET",
        );
      } catch (e) {
        logger.error("[FilaCommand] Erro ao buscar fila:", e);
        return reply("❌ Erro ao buscar fila.");
      }

      if (!data.success) {
        return reply(`❌ Erro ao buscar fila: ${data.message || data.error}`);
      }

      const queue = data.queue;

      if (!queue || queue.length === 0) {
        return reply("📋 A fila está vazia no momento.");
      }

      // Build queue message
      let queueText = "🎵 *FILA COLABORATIVA* 🎵\n\n";

      for (let i = 0; i < queue.length; i++) {
        const entry = queue[i];
        const addedByName = await resolveUserName(
          entry.addedByUser.sender_number,
          client,
        );

        queueText += `*${i + 1}.* ${entry.trackName}\n`;
        queueText += `   🎤 ${entry.trackArtists}\n`;
        queueText += `   👤 Adicionado por: ${addedByName}\n\n`;
      }

      queueText += `📊 Total: ${queue.length} ${queue.length === 1 ? "música" : "músicas"}`;

      return reply(queueText);
    } catch (err) {
      logger.error("[FilaCommand] Error showing queue:", err);
      return reply(
        "❌ Erro ao mostrar fila. Tente novamente em alguns instantes.",
      );
    }
  },
};
