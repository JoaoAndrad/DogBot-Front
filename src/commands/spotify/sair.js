const backend = require("../../services/backendClient");

module.exports = {
  name: "sair",
  aliases: ["jam.sair", "deixar"],
  description: "Sair da jam/rádio atual",
  async execute(ctx) {
    const reply =
      typeof ctx.reply === "function" ? ctx.reply : (t) => console.log(t);

    // Get user ID
    let userId = null;
    try {
      const msg = ctx.message;
      if (msg && typeof msg.getContact === "function") {
        const contact = await msg.getContact();
        userId = contact.id._serialized || contact.id;
      } else {
        userId = (msg && (msg.from || msg.author)) || ctx.sender || null;
      }
    } catch (err) {
      console.log("[sair] Failed to resolve contact:", err.message);
      userId =
        (ctx.message && (ctx.message.from || ctx.message.author)) ||
        ctx.sender ||
        null;
    }

    if (!userId) {
      await reply("❌ Não foi possível identificar seu usuário.");
      return;
    }

    try {
      // Check user's current jam status
      const statusResult = await backend.sendToBackend(
        `/api/jam/user/${userId}/status`,
        null,
        "GET",
      );

      if (!statusResult.success) {
        await reply("❌ Erro ao verificar status. Tente novamente.");
        return;
      }

      if (!statusResult.role || !statusResult.jam) {
        await reply("❌ Você não está em nenhuma jam no momento.");
        return;
      }

      const jam = statusResult.jam;
      const isHost = statusResult.role === "host";

      if (isHost) {
        // Host is ending the jam
        const endResult = await backend.sendToBackend(
          `/api/jam/${jam.id}`,
          { userId },
          "DELETE",
        );

        if (!endResult.success) {
          await reply(
            `❌ Erro ao encerrar jam: ${endResult.message || endResult.error}`,
          );
          return;
        }

        const listenerCount =
          jam.listeners?.filter((l) => l.isActive)?.length || 0;

        let msg = `🎵 *Jam encerrada!*\n\n`;
        if (listenerCount > 0) {
          msg += `${listenerCount} ouvinte(s) foram desconectados.\n`;
        }
        msg += `Obrigado por usar a jam!`;

        await reply(msg);

        // Notify listeners (via SSE would be better, but send individual messages as fallback)
        // This would typically be handled by SSE in a real implementation
      } else {
        // Listener is leaving the jam
        const leaveResult = await backend.sendToBackend(
          `/api/jam/${jam.id}/leave`,
          { userId },
          "POST",
        );

        if (!leaveResult.success) {
          await reply(
            `❌ Erro ao sair da jam: ${leaveResult.message || leaveResult.error}`,
          );
          return;
        }

        const hostName =
          jam.host?.push_name || jam.host?.display_name || "Anônimo";

        let msg = `👋 *Você saiu da jam de ${hostName}*\n\n`;
        msg += `Envie */jam* para criar sua própria jam ou entrar em outra.`;

        await reply(msg);
      }
    } catch (err) {
      console.error("[sair] Error:", err);
      await reply(`❌ Erro ao sair da jam: ${err.message}`);
    }
  },
};
