const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

/**
 * Comando /treinei para registrar treino
 * Funciona da mesma forma que mencionar o bot + "treinei"
 */
module.exports = {
  name: "treinei",
  aliases: ["!treinei"],
  description: "Registrar treino do dia",
  async execute(ctx) {
    try {
      const msg = ctx.message;
      const chat = msg.getChat ? await msg.getChat() : ctx.chat;
      const isGroup = chat.isGroup;
      const from = msg.from;

      // Só funciona em grupos
      if (!isGroup) {
        await ctx.reply("❌ Esse comando só funciona em grupos!");
        return;
      }

      // Verificar se o grupo tem treinos ativados
      try {
        const settings = await backendClient.sendToBackend(
          `/api/workouts/groups/${encodeURIComponent(from)}/settings`,
          null,
          "GET",
        );
        if (!settings || !settings.workoutTrackingEnabled) {
          logger.info(
            `[treinei] Group ${from} does not have workout tracking enabled, ignoring.`,
          );
          return;
        }
      } catch (err) {
        logger.warn(
          `[treinei] Could not verify group settings for ${from}, aborting:`,
          err?.message,
        );
        return;
      }

      const author = msg.author || msg.from || ctx.info?.from;

      // Resolve author @lid to real @c.us
      let senderNumber = null;
      let displayName = null;
      try {
        const contact = await ctx.client.getContactById(author);
        const resolvedAuthor = contact?.id?._serialized || author;
        senderNumber = resolvedAuthor.replace(/@c\.us$/i, "");
        displayName =
          contact?.pushname || contact?.name || contact?.notify || null;
        logger.info(
          `[treinei] Author resolved: ${author} → ${resolvedAuthor} → ${senderNumber} (${displayName})`,
        );
      } catch (err) {
        // Fallback to original author
        senderNumber = author.replace(/@(c\.us|lid)$/i, "");
        logger.info(`[treinei] Author fallback: ${author} → ${senderNumber}`);
      }

      // Extract note: remove "/treinei" command
      const body =
        msg.body || (msg._data && msg._data.caption) || ctx.info?.body || "";
      const note =
        body
          .replace(/^(\/|!)treinei\s*/i, "") // Remove command
          .trim() || null;

      logger.info(
        `[treinei] Processing workout for ${senderNumber} in ${from}`,
      );

      // Send to backend
      const workoutNotificationService = require("../../services/workoutNotificationService");
      const groupRankingService = require("../../services/groupRankingService");

      const result = await backendClient.sendToBackend(
        "/api/workouts/log",
        {
          senderNumber,
          chatId: from,
          messageId: msg.id?._serialized,
          note,
          loggedAt: new Date().toISOString(),
        },
        "POST",
      );

      if (result.success) {
        await msg.reply(result.message || "🔥 Treino registrado!");

        const groupChatIds = await workoutNotificationService.getGroupsWithTrackingForUser(
          ctx.client,
          senderNumber,
        );

        // Anúncio nos *outros* grupos; o grupo atual já recebeu a confirmação com msg.reply
        await workoutNotificationService.sendWorkoutMessageToGroups(
          ctx.client,
          groupChatIds,
          result.stats,
          displayName,
          from,
        );

        // Update description in all groups the user is in
        setTimeout(async () => {
          for (const chatId of groupChatIds) {
            try {
              await groupRankingService.updateGroupRanking(chatId);
              await new Promise((r) => setTimeout(r, 500));
            } catch (err) {
              logger.error("[treinei] Error updating ranking for " + chatId, err);
            }
          }
        }, 1000);
      } else if (result.error === "workout_already_logged_today") {
        await msg.reply("Você já registrou treino hoje! 💪");
      }
    } catch (err) {
      logger.error("[treinei] Error processing workout:", err);
      await ctx.reply("❌ Erro ao registrar treino. Tente novamente.");
    }
  },
};
