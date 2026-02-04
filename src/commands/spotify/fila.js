const logger = require("../../../../backend/src/lib/logger");
const { getConfig } = require("../../../core/config");
const getPushName = require("../../../utils/getPushName");
const { JamMonitor } = require("../../../services/jamMonitor");

const config = getConfig();
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * /fila - Show collaborative jam queue
 */
async function filaCommand(msg) {
  const sender = msg.from;
  const senderNumber = sender.replace("@c.us", "");

  try {
    // Check if jam is active
    const jamState = JamMonitor.getJamState(senderNumber);

    if (!jamState) {
      await msg.reply("❌ Você não está em uma jam ativa.");
      return;
    }

    // Get queue from backend
    const response = await fetch(
      `${BACKEND_URL}/api/jam/${jamState.jamId}/queue`,
    );

    if (!response.ok) {
      await msg.reply("❌ Erro ao buscar fila.");
      return;
    }

    const data = await response.json();

    if (!data.success) {
      await msg.reply(`❌ Erro ao buscar fila: ${data.message || data.error}`);
      return;
    }

    const queue = data.queue;

    if (!queue || queue.length === 0) {
      await msg.reply("📋 A fila está vazia no momento.");
      return;
    }

    // Build queue message
    let queueText = "🎵 *FILA COLABORATIVA* 🎵\n\n";

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      const addedByName = await getPushName(entry.addedByUser.sender_number);

      queueText += `*${i + 1}.* ${entry.trackName}\n`;
      queueText += `   🎤 ${entry.trackArtists}\n`;
      queueText += `   👤 Adicionado por: ${addedByName}\n\n`;
    }

    queueText += `📊 Total: ${queue.length} ${queue.length === 1 ? "música" : "músicas"}`;

    await msg.reply(queueText);
  } catch (err) {
    logger.error("[FilaCommand] Error showing queue:", err);
    await msg.reply(
      "❌ Erro ao mostrar fila. Tente novamente em alguns instantes.",
    );
  }
}

module.exports = {
  name: "fila",
  aliases: ["queue", "q"],
  description: "Mostra a fila colaborativa da jam",
  category: "spotify",
  requiredArgs: 0,
  execute: filaCommand,
};
