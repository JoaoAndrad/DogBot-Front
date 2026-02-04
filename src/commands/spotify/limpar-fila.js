const logger = require("../../../../backend/src/lib/logger");
const { getConfig } = require("../../../core/config");
const { JamMonitor } = require("../../../services/jamMonitor");

const config = getConfig();
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * /limpar-fila - Clear collaborative queue (host only)
 */
async function limparFilaCommand(msg) {
  const sender = msg.from;
  const senderNumber = sender.replace("@c.us", "");

  try {
    // Check if jam is active
    const jamState = JamMonitor.getJamState(senderNumber);

    if (!jamState) {
      await msg.reply("❌ Você não está em uma jam ativa.");
      return;
    }

    // Get user ID
    const userResponse = await fetch(
      `${BACKEND_URL}/api/users/by-sender-number/${senderNumber}`,
    );

    if (!userResponse.ok) {
      await msg.reply("❌ Erro ao buscar usuário.");
      return;
    }

    const userData = await userResponse.json();
    if (!userData.success) {
      await msg.reply("❌ Erro ao buscar usuário.");
      return;
    }

    const userId = userData.user.id;

    // Clear queue
    const response = await fetch(
      `${BACKEND_URL}/api/jam/${jamState.jamId}/queue`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      },
    );

    if (!response.ok) {
      await msg.reply("❌ Erro ao limpar fila.");
      return;
    }

    const data = await response.json();
    if (!data.success) {
      await msg.reply(`❌ ${data.message || data.error}`);
      return;
    }

    const deletedCount = data.deletedCount;

    await msg.reply(
      `✅ *Fila limpa!*\n\n` +
        `🗑️ ${deletedCount} ${deletedCount === 1 ? "música removida" : "músicas removidas"}.`,
    );
  } catch (err) {
    logger.error("[LimparFilaCommand] Error clearing queue:", err);
    await msg.reply(
      "❌ Erro ao limpar fila. Tente novamente em alguns instantes.",
    );
  }
}

module.exports = {
  name: "limpar-fila",
  aliases: ["limparfila", "clear-queue"],
  description: "Limpa a fila colaborativa (apenas host)",
  category: "spotify",
  requiredArgs: 0,
  execute: limparFilaCommand,
};
