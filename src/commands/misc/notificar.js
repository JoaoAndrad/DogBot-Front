const backendClient = require("../../services/backendClient");

module.exports = {
  name: "notificar",
  description:
    "Enviar uma notificação em massa para todos os usuários registrados (apenas admin, privado apenas).",
  async execute(ctx) {
    const { message, info, reply } = ctx;

    // Check if this is a group message - ignore silently if in group
    let isGroup = !!(message && message.isGroup) || !!(info && info.is_group);
    if (!isGroup) {
      const chatId = (message && message.from) || (info && info.from) || "";
      if (chatId && String(chatId).endsWith("@g.us")) {
        isGroup = true;
      }
    }

    if (isGroup) {
      // Silently ignore group invocations
      return;
    }

    // Get sender WhatsApp ID
    let senderNumber = null;
    try {
      if (message && typeof message.getContact === "function") {
        const contact = await message.getContact();
        if (contact && contact.id && contact.id._serialized)
          senderNumber = contact.id._serialized;
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

    // Check if user is admin via backend
    let isAdmin = false;
    try {
      const userResp = await backendClient.sendToBackend(
        `/api/users/by-whatsapp/${encodeURIComponent(senderNumber)}`,
        null,
        "GET",
      );
      if (userResp && userResp.isAdmin) {
        isAdmin = true;
      }
    } catch (err) {
      console.error("Erro ao verificar admin status:", err?.message);
      await reply("❌ Erro ao verificar permissões de administrador.");
      return;
    }

    if (!isAdmin) {
      await reply("❌ Este comando é restrito a administradores.");
      return;
    }

    // Parse command body
    const raw = (info && info.body) || (message && message.body) || "";
    let text = raw;

    // Remove leading command token (/notificar or notificar)
    try {
      const cmdMatch = raw.match(/^\s*\/?notificar\b[:\s]*/i);
      text = cmdMatch ? raw.slice(cmdMatch[0].length) : raw;
    } catch (e) {
      text = raw;
    }

    text = text.trim();

    // Check for dryrun mode
    const isDryRun = text.toLowerCase().startsWith("dryrun");
    if (isDryRun) {
      // Remove "dryrun" from the message
      text = text.slice("dryrun".length).trim();
    }

    if (!text || text.length === 0) {
      await reply(
        "📢 *Uso do comando /notificar*\n\n" +
          "• `/notificar <mensagem>` - Envia notificação para todos\n" +
          "• `/notificar dryrun <mensagem>` - Preview sem enviar\n\n" +
          "Exemplo:\n" +
          "`/notificar dryrun O bot estará fora do ar`",
      );
      return;
    }

    // If dryrun, get count and show preview
    if (isDryRun) {
      try {
        const countResp = await backendClient.sendToBackend(
          "/api/broadcasts/count",
          null,
          "GET",
        );
        const count = countResp?.count || 0;

        await reply(
          `📊 *Preview do Broadcast*\n\n` +
            `O Broadcast será feito para *${count} usuários*\n\n` +
            `Corpo da mensagem:\n\n${text}`,
        );
      } catch (err) {
        console.error("Erro ao obter contagem de usuários:", err?.message);
        await reply("❌ Erro ao obter contagem de usuários para preview.");
      }
      return;
    }

    // Create broadcast
    try {
      await reply("⏳ Criando broadcast...");

      const createResp = await backendClient.sendToBackend(
        "/api/broadcasts",
        {
          message: text,
          createdBy: senderNumber,
        },
        "POST",
      );

      if (createResp && createResp.id) {
        const broadcastId = createResp.id;
        const recipientCount = createResp.recipientCount || 0;
        const recipients = createResp.recipients || [];

        await reply(
          `✅ *Broadcast criado!*\n\n` +
            `ID: ${broadcastId}\n` +
            `Destinatários: ${recipientCount} usuários\n\n` +
            `Enviando mensagens...`,
        );

        // Send messages to all recipients (temporary implementation until worker is ready)
        let successCount = 0;
        let errorCount = 0;

        for (const recipientId of recipients) {
          try {
            await ctx.client.sendMessage(recipientId, text);
            successCount++;

            // Add small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (err) {
            console.error(
              `[Broadcast] Erro ao enviar para ${recipientId}:`,
              err?.message,
            );
            errorCount++;
          }
        }

        await reply(
          `✅ *Broadcast concluído!*\n\n` +
            `Enviadas: ${successCount}\n` +
            `Erros: ${errorCount}\n` +
            `Total: ${recipientCount}`,
        );
      } else {
        await reply("✅ Broadcast criado, mas sem detalhes de confirmação.");
      }
    } catch (err) {
      console.error("Erro ao criar broadcast:", err?.message);
      await reply(
        "❌ Erro ao criar broadcast: " +
          (err?.response?.data?.error || err?.message || "Erro desconhecido"),
      );
    }
  },
};
