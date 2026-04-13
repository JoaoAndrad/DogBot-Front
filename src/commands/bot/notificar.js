const backendClient = require("../../services/backendClient");
const polls = require("../../components/poll");

/** Compara JIDs do mesmo utilizador (ex.: @c.us vs @lid resolvido). */
function jidMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = String(a).split("@")[0];
  const nb = String(b).split("@")[0];
  return na.length > 0 && na === nb;
}

module.exports = {
  name: "notificar",
  aliases: ["notify", "notificacao", "notificacoes"],
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

    // Remove leading command token (/notificar, /notify, …)
    try {
      const cmdMatch = raw.match(
        /^\s*\/?(?:notificar|notify|notificacao|notificacoes)\b[:\s]*/i,
      );
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
        "📢 *Comando /notificar* (só administradores, só no privado com o bot)\n\n" +
          "Envia a *mesma mensagem* a *todos os utilizadores registados* no sistema.\n\n" +
          "*Como usar*\n" +
          "• `/notificar <texto>` — será enviada uma *enquete* e, se confirmar, envia mensagem a todos.\n" +
          "• `/notificar dryrun <texto>` — *ensaiar*: mostra quantos utilizadores receberiam e o texto, *sem enviar* nada.\n\n" +
          "*Também pode usar:* `/notify`, `/notificacao` ou `/notificacoes` (com o mesmo significado).\n\n" +
          "*Exemplos*\n" +
          "`/notificar dryrun Vamos fazer manutenção amanhã de manhã.`\n" +
          "`/notificar A partir de hoje há novidade no grupo X.`",
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

    if (!ctx.client) {
      await reply(
        "❌ Cliente indisponível para criar a enquete de confirmação. Tente de novo.",
      );
      return;
    }

    const chatId =
      (message && message.from) ||
      (info && info.from) ||
      senderNumber;

    const runBroadcastAfterConfirm = async () => {
      try {
        await ctx.client.sendMessage(chatId, "⏳ Criando broadcast...");

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

          await ctx.client.sendMessage(
            chatId,
            `✅ *Broadcast criado!*\n\n` +
              `ID: ${broadcastId}\n` +
              `Destinatários: ${recipientCount} usuários\n\n` +
              `Enviando mensagens...`,
          );

          let successCount = 0;
          let errorCount = 0;

          for (let recipientId of recipients) {
            try {
              if (!recipientId.includes("@")) {
                recipientId = `${recipientId}@c.us`;
              }

              await ctx.client.sendMessage(recipientId, text);
              successCount++;

              await new Promise((resolve) => setTimeout(resolve, 500));
            } catch (err) {
              console.error(
                `[Broadcast] Erro ao enviar para ${recipientId}:`,
                err?.message,
              );
              errorCount++;
            }
          }

          await ctx.client.sendMessage(
            chatId,
            `✅ *Broadcast concluído!*\n\n` +
              `Enviadas: ${successCount}\n` +
              `Erros: ${errorCount}\n` +
              `Total: ${recipientCount}`,
          );
        } else {
          await ctx.client.sendMessage(
            chatId,
            "✅ Broadcast criado, mas sem detalhes de confirmação.",
          );
        }
      } catch (err) {
        console.error("Erro ao criar broadcast:", err?.message);
        await ctx.client.sendMessage(
          chatId,
          "❌ Erro ao criar broadcast: " +
            (err?.response?.data?.error || err?.message || "Erro desconhecido"),
        );
      }
    };

    await reply(
      "📋 Responda a enquete abaixo para confirmar ou cancelar o envio da mensagem.",
    );

    let confirmationHandled = false;

    const confirmRes = await polls.createPoll(
      ctx.client,
      chatId,
      "Enviar esta notificação a todos os usuários registrados?",
      ["✅ Sim, enviar", "❌ Não, cancelar"],
      {
        onVote: async (voteData) => {
          try {
            const voter = voteData.voter;
            if (!jidMatches(voter, senderNumber)) {
              return;
            }

            if (confirmationHandled) {
              return;
            }

            const selectedIndexRaw =
              voteData.selectedIndexes && voteData.selectedIndexes[0];
            const selectedIndex =
              selectedIndexRaw != null ? Number(selectedIndexRaw) : null;

            if (selectedIndex === 1) {
              confirmationHandled = true;
              await ctx.client.sendMessage(
                chatId,
                "❌ Envio em massa cancelado.",
              );
              return;
            }

            if (selectedIndex !== 0) {
              return;
            }

            confirmationHandled = true;
            await runBroadcastAfterConfirm();
          } catch (err) {
            console.error("[notificar] onVote:", err?.message);
            try {
              await ctx.client.sendMessage(
                chatId,
                "❌ Erro ao processar o teu voto na enquete.",
              );
            } catch (_) {
              /* ignore */
            }
          }
        },
      },
    );

    if (!confirmRes || !confirmRes.msgId) {
      await reply("❌ Não foi possível criar a enquete de confirmação.");
    }
  },
};
