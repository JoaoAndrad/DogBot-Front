const axios = require("axios");
const logger = require("../../../../backend/src/lib/logger");
const { getConfig } = require("../../../core/config");
const getPushName = require("../../../utils/getPushName");
const { JamMonitor } = require("../../../services/jamMonitor");

const config = getConfig();

/**
 * /democratizar - Toggle jam between classic and collaborative mode
 */
async function democratizarCommand(msg) {
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
    const userResponse = await axios.get(
      `${config.BACKEND_URL}/api/users/by-sender-number/${senderNumber}`,
    );

    if (!userResponse.data.success) {
      await msg.reply("❌ Erro ao buscar usuário.");
      return;
    }

    const userId = userResponse.data.user.id;

    // Get jam details to check if user is host
    const jamResponse = await axios.get(
      `${config.BACKEND_URL}/api/jam/${jamState.jamId}`,
    );

    if (!jamResponse.data.success) {
      await msg.reply("❌ Erro ao buscar jam.");
      return;
    }

    const jam = jamResponse.data.jam;

    // Check if user is host
    if (jam.hostUserId !== userId) {
      await msg.reply("❌ Apenas o host pode mudar o modo da jam.");
      return;
    }

    // Toggle jam type
    const newType =
      jam.jamType === "collaborative" ? "classic" : "collaborative";

    const updateResponse = await axios.patch(
      `${config.BACKEND_URL}/api/jam/${jamState.jamId}`,
      {
        jamType: newType,
      },
    );

    if (!updateResponse.data.success) {
      await msg.reply(
        `❌ Erro ao atualizar jam: ${updateResponse.data.message || updateResponse.data.error}`,
      );
      return;
    }

    // Update jam state in monitor
    jamState.jamType = newType;

    if (newType === "collaborative") {
      await msg.reply(
        "🎉 *JAM DEMOCRATIZADA!*\n\n" +
          "✅ Modo colaborativo ativado!\n\n" +
          "Agora todos podem adicionar músicas à fila usando:\n" +
          "*/adicionar <música>*\n\n" +
          "As músicas precisam de aprovação dos participantes para entrar na fila.\n\n" +
          "Use */fila* para ver a fila.",
      );
    } else {
      await msg.reply(
        "🎵 *JAM CLÁSSICA*\n\n" +
          "✅ Modo clássico ativado!\n\n" +
          "Apenas o host pode controlar a reprodução.\n\n" +
          "A fila colaborativa foi mantida mas não será reproduzida automaticamente.",
      );
    }
  } catch (err) {
    logger.error("[DemocratizarCommand] Error toggling jam mode:", err);
    await msg.reply(
      "❌ Erro ao mudar modo da jam. Tente novamente em alguns instantes.",
    );
  }
}

module.exports = {
  name: "democratizar",
  aliases: ["colaborativo", "colab"],
  description: "Alterna entre modo clássico e colaborativo da jam",
  category: "spotify",
  requiredArgs: 0,
  execute: democratizarCommand,
};
