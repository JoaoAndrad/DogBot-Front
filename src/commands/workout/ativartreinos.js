const backendClient = require("../../services/backendClient");
const groupRankingService = require("../../services/groupRankingService");

module.exports = {
  name: "ativartreinos",
  aliases: ["ativar-treinos", "ativatetreino"],
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
        if (contact && contact.id && contact.id._serialized) {
          senderNumber = contact.id._serialized;
        }
      }
    } catch (err) {
      // ignore
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
      const lookup = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(senderNumber)}`,
        null,
        "GET",
      );

      if (lookup && lookup.found && lookup.isAdmin) {
        isAdmin = true;
      }

      console.log(
        `[ativartreinos] Usuário ${senderNumber.replace(/@c\.us$/i, "")} tentou executar comando. isAdmin: ${!!lookup?.isAdmin}`,
      );
    } catch (err) {
      console.error(
        "[ativartreinos] Erro ao verificar admin status:",
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

    // Check if already ativated
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
      console.error("[ativartreinos] Error checking group status:", err);
      // Continue with ativation if check fails
    }

    // ativate group
    try {
      const result = await backendClient.sendToBackend(
        "/api/workouts/ativate-group",
        {
          chatId,
          ativatedBy: senderNumber,
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
            console.log(
              `[ativartreinos] Initial ranking update completed for ${chatId}`,
            );
          } catch (err) {
            console.error(`[ativartreinos] Error updating ranking:`, err);
          }
        }, 1000);
      } else {
        await reply("❌ Erro ao ativar sistema de treinos. Tente novamente.");
      }
    } catch (err) {
      console.error("[ativartreinos] Error ativating group:", err);
      await reply("❌ Erro ao ativar sistema de treinos. Tente novamente.");
    }
  },
};
