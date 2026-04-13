const backendClient = require("../../services/backendClient");
const groupRankingService = require("../../services/groupRankingService");
const logger = require("../../utils/logger");
const {
  jidFromContact,
  lookupByIdentifier,
} = require("../../utils/whatsapp/getUserData");

module.exports = {
  name: "ativartreinos",
  aliases: ["ativar-treinos", "activatetreino"],
  description: "Ativa sistema de treinos no grupo (apenas admin do sistema).",

  async execute(ctx) {
    const { message, info, reply } = ctx;

    // Check if this is a group message
    let isGroup = !!(message && message.isGroup) || !!(info && info.is_group);
    const chatId = (message && message.from) || (info && info.from) || "";

    if (!isGroup && chatId && String(chatId).endsWith("@g.us")) {
      isGroup = true;
    }

    if (!isGroup) {
      await reply("❌ Este comando só funciona em grupos.");
      return;
    }

    // Get sender WhatsApp ID
    let senderNumber = null;
    try {
      if (message && typeof message.getContact === "function") {
        const contact = await message.getContact();
        senderNumber =
          jidFromContact(contact) ||
          (contact && contact.id && contact.id._serialized) ||
          null;
      }
    } catch (err) {
      logger.debug("[ativartreinos] Erro ao obter contacto:", err.message);
    }

    if (!senderNumber) {
      senderNumber =
        (info && info.from) ||
        (message && (message.from || message.author)) ||
        null;
    }

    if (!senderNumber) {
      await reply("❌ Não foi possível identificar seu número.");
      return;
    }

    // Check if user is admin via backend (NOT WhatsApp group admin)
    let isAdmin = false;
    try {
      const lookup = await lookupByIdentifier(senderNumber);

      if (lookup && lookup.found && lookup.isAdmin) {
        isAdmin = true;
      }

      logger.info(
        `[ativartreinos] Usuário ${senderNumber.replace(/@c\.us$/i, "")} tentou executar comando. isAdmin: ${!!lookup?.isAdmin}`,
      );
    } catch (err) {
      logger.error(
        "[ativartreinos] Erro ao verificar status de admin:",
        err?.message,
      );
      await reply("❌ Erro ao verificar permissões de administrador.");
      return;
    }

    if (!isAdmin) {
      await reply(
        "❌ Este comando é restrito a administradores do sistema.\n\n" +
          "Solicite a um admin do bot para ativar este grupo.",
      );
      return;
    }

    // Check if already activated
    try {
      const settings = await backendClient.sendToBackend(
        `/api/workouts/groups/${encodeURIComponent(chatId)}/settings`,
        null,
        "GET",
      );

      if (settings && settings.workoutTrackingEnabled) {
        await reply(
          "✅ Sistema de treinos já está ativado neste grupo!\n\n" +
            "📝 Para registrar: mencione o bot + treinei\n" +
            "🎯 Use /meta no privado para definir sua meta anual",
        );
        return;
      }
    } catch (err) {
      logger.error("[ativartreinos] Erro ao verificar estado do grupo:", err);
      // Continue with activation if check fails
    }

    // Activate group
    try {
      const result = await backendClient.sendToBackend(
        "/api/workouts/activate-group",
        {
          chatId,
          activatedBy: senderNumber,
        },
        "POST",
      );

      if (result.success) {
        await reply(
          "🏋️ *Sistema de Treinos Ativado!* 🏋️\n\n" +
            "✅ Todos os membros do grupo com cadastro estão participando\n" +
            "📝 Para registrar: mencione o bot + treinei\n" +
            "    Exemplo: @DogBot treinei\n" +
            "🏆 Vencedor mensal ganha troféu\n" +
            "📊 Ranking atualizado automaticamente na descrição\n" +
            "🎯 Use /meta no privado para definir sua meta anual\n\n" +
            "🔥 Bora treinar!",
        );

        // Trigger immediate ranking update
        setTimeout(async () => {
          try {
            await groupRankingService.updateGroupRanking(chatId);
            logger.info(
              `[ativartreinos] Atualização inicial de ranking concluída para ${chatId}`,
            );
          } catch (err) {
            logger.error(`[ativartreinos] Erro ao atualizar ranking:`, err);
          }
        }, 1000);
      } else {
        await reply("❌ Erro ao ativar sistema de treinos. Tente novamente.");
      }
    } catch (err) {
      logger.error("[ativartreinos] Erro ao ativar grupo:", err);
      await reply("❌ Erro ao ativar sistema de treinos. Tente novamente.");
    }
  },
};
