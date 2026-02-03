module.exports = {
  name: "notificar",
  description:
    "Enviar uma notificação em massa para todos os usuários registrados (apenas admin, privado apenas).",
  async execute(ctx) {
    const { message, info, reply, services } = ctx;

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
    const backendClient = services?.backendClient;
    if (!backendClient) {
      await reply("❌ Serviço de backend não disponível.");
      return;
    }

    let isAdmin = false;
    try {
      const userResp = await backendClient.get(
        `/api/users/by-whatsapp/${encodeURIComponent(senderNumber)}`,
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
        const countResp = await backendClient.get("/api/broadcasts/count");
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

      const createResp = await backendClient.post("/api/broadcasts", {
        message: text,
        createdBy: senderNumber,
      });

      if (createResp && createResp.id) {
        const broadcastId = createResp.id;
        const recipientCount = createResp.recipientCount || 0;

        await reply(
          `✅ *Broadcast criado com sucesso!*\n\n` +
            `ID: ${broadcastId}\n` +
            `Destinatários: ${recipientCount} usuários\n` +
            `Status: Processando\n\n` +
            `As mensagens serão enviadas em breve.`,
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
