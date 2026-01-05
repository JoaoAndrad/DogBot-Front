module.exports = {
  name: "confissao",
  description:
    "Enviar uma confissão anonimamente para o grupo configurado (privado apenas).",
  async execute(ctx) {
    const { message, info, reply, client, services } = ctx;

    const isGroup = !!(message && message.isGroup) || !!(info && info.is_group);
    if (isGroup) {
      await reply(
        "Confissões só podem ser enviadas no privado. Por favor envie este comando em uma conversa privada comigo."
      );
      return;
    }

    // determine sender identifier (serialized id like 5581...@c.us)
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

    // parse command body to extract confession text (remove leading /confissao)
    const raw = (info && info.body) || (message && message.body) || "";
    const parts = raw.trim().split(/\s+/);
    let text = parts.slice(1).join(" ").trim();

    if (!text) {
      await reply(
        "Uso: /confissao <sua mensagem>\nEx: /confissao confesso que..."
      );
      return;
    }

    // only text supported for now
    if (message && message.hasMedia) {
      await reply(
        "Envio de mídia em confissões não é suportado por enquanto. Envie apenas texto."
      );
      return;
    }

    // Find groups in common with the user by scanning bot chats and checking membership
    let chats = [];
    try {
      // client.getChats may return many chats; filter group chats
      chats = await client.getChats();
    } catch (err) {
      console.error(
        "Erro ao listar chats do cliente:",
        err && err.message ? err.message : err
      );
      await reply(
        "Não foi possível recuperar a lista de grupos no momento. Tente novamente mais tarde."
      );
      return;
    }

    const candidateGroups = [];
    for (const c of chats) {
      try {
        const chatId =
          c.id && c.id._serialized ? c.id._serialized : c.id || null;
        if (!chatId) continue;
        const isG = !!c.isGroup || String(chatId).endsWith("@g.us");
        if (!isG) continue;

        // try to get participants from chat object; if missing, fetch via getChatById
        let participants = c.participants;
        if (!Array.isArray(participants)) {
          try {
            const full = await client.getChatById(chatId);
            participants = full && full.participants ? full.participants : [];
          } catch (e) {
            participants = [];
          }
        }

        if (!Array.isArray(participants) || participants.length === 0) continue;

        const memberIds = participants
          .map((p) => (p && p.id && p.id._serialized ? p.id._serialized : null))
          .filter(Boolean);

        if (memberIds.includes(senderNumber)) {
          // get readable name
          const name =
            c.name || (c.contact && c.contact.name) || chatId.split("@")[0];
          candidateGroups.push({ id: chatId, name });
        }
      } catch (e) {
        // ignore per-chat errors
      }
    }

    if (!candidateGroups.length) {
      await reply(
        "Não encontrei nenhum grupo em comum com você onde eu esteja presente. Peça ao administrador para adicionar o bot no grupo desejado."
      );
      return;
    }

    // If there's exactly one group in common, skip the poll and send directly
    if (candidateGroups.length === 1) {
      const target = candidateGroups[0];
      try {
        const groupMsg = `*📩 Confissão:* ${text}`;
        await client.sendMessage(target.id, groupMsg);
      } catch (err) {
        console.error(
          "Erro ao enviar confissão ao grupo (único grupo):",
          err && err.message ? err.message : err
        );
        await reply(
          "Ocorreu um erro ao enviar a confissão ao grupo. Tente novamente mais tarde."
        );
        return;
      }

      // consume balance
      try {
        const res = await services.backend.sendToBackend(
          "/api/confessions/consume",
          { senderNumber },
          "POST"
        );
        try {
          const remaining = res && res.remaining;
          const isVip =
            remaining === null ||
            remaining === Infinity ||
            String(remaining).toLowerCase() === "infinity";
          if (isVip) {
            await reply(
              "*🎉 Sua confissão foi enviada anonimamente com sucesso!* \n\n🙏 Você possui confissões vitalícias — não será debitado. 💸"
            );
          } else if (res && res.ok) {
            await reply(
              `*✅ Sua confissão foi enviada anonimamente com sucesso!* \n\n📩 *Enviada para:* ${
                target.name
              }\n*Saldo restante:* ${remaining} confissão${
                remaining === 1 ? "" : "ões"
              }`
            );
          } else if (res && res.reason === "insufficient_balance") {
            await reply(
              `⚠️ Sua confissão foi enviada ao grupo ${target.name}, porém seu saldo está insuficiente para futuras confissões.`
            );
          } else {
            await reply(
              `✅ Confissão enviada ao grupo ${target.name}. Não foi possível atualizar seu saldo no momento.`
            );
          }
        } catch (e) {
          // ignore reply errors
        }
      } catch (err) {
        console.error(
          "Erro ao notificar backend sobre consumo de confissão (único grupo):",
          err && err.message ? err.message : err
        );
        try {
          await reply(
            "Confissão enviada, porém ocorreu um erro ao atualizar seu saldo."
          );
        } catch (e) {}
      }

      return;
    }

    // Build poll options (labels) and keep mapping to chat ids
    const polls = require("../../components/poll");
    const optionLabels = candidateGroups.map((g) => g.name || g.id);
    const optionChatIds = candidateGroups.map((g) => g.id);

    try {
      // create a poll in the user's private chat to choose target group
      await polls.createPoll(
        client,
        senderNumber,
        "Escolha o grupo para enviar sua confissão",
        optionLabels,
        {
          onVote: async (payload) => {
            try {
              const idxs =
                payload && payload.selectedIndexes
                  ? payload.selectedIndexes
                  : [];
              if (!idxs || !idxs.length) return;
              const pick = Number(idxs[0]);
              const targetChat = optionChatIds[pick];
              if (!targetChat) return;

              // send confession to selected group (formatted)
              try {
                const groupMsg = `*📩 Confissão:* ${text}`;
                await client.sendMessage(targetChat, groupMsg);
              } catch (err) {
                console.error(
                  "Erro ao enviar confissão ao grupo selecionado:",
                  err && err.message ? err.message : err
                );
                // notify user privately about failure
                try {
                  await reply(
                    "Ocorreu um erro ao enviar a confissão ao grupo selecionado."
                  );
                } catch (e) {}
                return;
              }

              // notify backend to consume balance
              try {
                const res = await services.backend.sendToBackend(
                  "/api/confessions/consume",
                  { senderNumber },
                  "POST"
                );
                if (res && res.ok) {
                  try {
                    const remaining = res.remaining;
                    const isVip =
                      remaining === null ||
                      remaining === Infinity ||
                      String(remaining).toLowerCase() === "infinity";
                    if (isVip) {
                      await reply(
                        "*🎉 Sua confissão foi enviada anonimamente com sucesso!* \n\n🙏 Você possui confissões vitalícias — não será debitado. 💸"
                      );
                    } else {
                      await reply(
                        `*✅ Sua confissão foi enviada anonimamente com sucesso!* \n\n📩 *Enviada para:* ${
                          candidateGroups[pick].name
                        }\n*Saldo restante:* ${remaining} confissão${
                          remaining === 1 ? "" : "ões"
                        }`
                      );
                    }
                  } catch (e) {}
                } else if (res && res.reason === "insufficient_balance") {
                  try {
                    await reply(
                      `⚠️ Sua confissão foi enviada ao grupo ${candidateGroups[pick].name}, porém seu saldo está insuficiente para futuras confissões.`
                    );
                  } catch (e) {}
                } else {
                  try {
                    await reply(
                      `✅ Confissão enviada ao grupo ${candidateGroups[pick].name}. Não foi possível atualizar seu saldo no momento.`
                    );
                  } catch (e) {}
                }
              } catch (err) {
                console.error(
                  "Erro ao notificar backend sobre consumo de confissão:",
                  err && err.message ? err.message : err
                );
                try {
                  await reply(
                    "Confissão enviada, porém ocorreu um erro ao atualizar seu saldo."
                  );
                } catch (e) {}
              }
            } catch (err) {
              console.error(
                "Erro no callback de votação da confissão:",
                err && err.message ? err.message : err
              );
            }
          },
        }
      );
    } catch (err) {
      console.error(
        "Erro ao criar enquete para seleção de grupo:",
        err && err.message ? err.message : err
      );
      await reply(
        "Não foi possível criar a enquete de seleção de grupo. Tente novamente mais tarde."
      );
    }
  },
};
