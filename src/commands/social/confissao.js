const jsonStore = require("../../storage/jsonStore");

/** Plural correcto em português: 1 confissão, 0/2+ confissões */
function pluralConfissao(count) {
  const n = Number(count);
  if (n === 1) return "confissão";
  return "confissões";
}

function linhaSaldoRestante(remaining) {
  return `*Saldo restante:* ${remaining} ${pluralConfissao(remaining)}`;
}

/**
 * Consome 1 confissão no backend. Erros de rede/5xx voltam a lançar.
 * 409 insufficient_balance e 404 user_not_found são resultados tratáveis (não lançam).
 */
async function consumeConfessionBalance(backend, senderNumber) {
  try {
    const res = await backend.sendToBackend(
      "/api/confessions/consume",
      { senderNumber },
      "POST",
    );
    if (res && res.ok) {
      return { ok: true, remaining: res.remaining };
    }
    return { ok: false, reason: "unknown" };
  } catch (err) {
    const status = err && err.status;
    const body = (err && err.body) || {};
    if (status === 409 && body.reason === "insufficient_balance") {
      return { ok: false, reason: "insufficient_balance" };
    }
    if (status === 404 || body.error === "user_not_found") {
      return { ok: false, reason: "user_not_found" };
    }
    throw err;
  }
}

module.exports = {
  name: "confissao",
  description:
    "Enviar uma confissão anonimamente para o grupo configurado (privado apenas).",
  async execute(ctx) {
    const { message, info, reply, client, services, fromCatchup } = ctx;

    // Array to collect poll messages for cleanup
    const pollMessages = [];

    // Helper function to delete messages and polls after confession is sent
    const cleanupAfterConfession = async (originalMsg, confirmationMsg) => {
      try {
        // Wait 2 seconds so user can see confirmation
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Delete all poll messages
        for (let i = 0; i < pollMessages.length; i++) {
          const entry = pollMessages[i];
          // entry is { pollMsg, chatId }
          const pollMsg = entry && entry.pollMsg ? entry.pollMsg : entry;
          const entryChatId = entry && entry.chatId ? entry.chatId : null;
          try {
            // createPoll returns { sent, msgId }, so we need to access sent property
            const messageToDelete =
              pollMsg && pollMsg.sent ? pollMsg.sent : pollMsg;

            if (
              messageToDelete &&
              typeof messageToDelete.delete === "function"
            ) {
              await messageToDelete.delete(false); // delete only for sender, not for everyone
            } else if (pollMsg && pollMsg.msgId && entryChatId) {
              // Fallback: attempt to delete by msgId via chat.deleteMessage
              try {
                const chat = await client.getChatById(entryChatId);
                if (chat && typeof chat.deleteMessage === "function") {
                  await chat.deleteMessage(pollMsg.msgId);
                } else if (
                  client &&
                  typeof client.deleteMessage === "function"
                ) {
                  // some client wrappers expose deleteMessage(chatId, msgId)
                  await client.deleteMessage(entryChatId, pollMsg.msgId);
                }
              } catch (err) {
                // Silently fail fallback deletion
              }
            }
          } catch (err) {
            // Silently fail poll deletion
          }
        }

        // Delete confirmation message (only for sender, not for everyone)
        if (confirmationMsg && typeof confirmationMsg.delete === "function") {
          try {
            await confirmationMsg.delete(false); // delete only for sender
          } catch (err) {
            // Silently fail confirmation deletion
          }
        }

        // Delete original message
        if (originalMsg && typeof originalMsg.delete === "function") {
          try {
            const deleteResult = await originalMsg.delete(true, true);

            // Alternative: try without parameters if first attempt returned undefined
            if (deleteResult === undefined || deleteResult === false) {
              await originalMsg.delete();
            }
          } catch (err) {
            console.error("[confissao] ERRO ao deletar mensagem original:", {
              error: err?.message || err,
              stack: err?.stack,
            });
          }
        } else {
        }
      } catch (err) {
        // Silently fail cleanup
      }
    };

    // Determine if this is a group message
    // Primary: check message.isGroup or info.is_group
    // Fallback: check if chat ID ends with @g.us (groups) vs @c.us (private)
    let isGroup = !!(message && message.isGroup) || !!(info && info.is_group);

    if (!isGroup) {
      // Fallback: check chat ID pattern
      const chatId = (message && message.from) || (info && info.from) || "";
      if (chatId && String(chatId).endsWith("@g.us")) {
        isGroup = true;
      }
    }

    if (isGroup) {
      // Ignore invocations in group chats silently (do not reply)
      return;
    }

    const msgIdSerialized =
      message && message.id && message.id._serialized
        ? message.id._serialized
        : null;

    // Catchup: nunca reabrir fluxo interativo; marca mensagem para não repetir no próximo arranque
    if (fromCatchup) {
      try {
        await reply(
          "Confissões interativas só em tempo real. Envie um novo /confissao com a sua mensagem.",
        );
      } catch (e) {
        /* ignore */
      }
      if (msgIdSerialized) jsonStore.markProcessed(msgIdSerialized);
      return;
    }

    // determine sender identifier
    // privateChatId = message.from = the actual WhatsApp chat this message came from.
    // This is ALWAYS the correct destination for polls/replies (@c.us or @lid — both work).
    // senderNumber is resolved to @c.us for backend identifier lookups only.
    const privateChatId =
      (message && message.from) || (info && info.from) || null;

    // pollChatId: always use message.from — it's the verified chat we can write back into.
    const pollChatId = privateChatId;

    let senderNumber = null;
    try {
      if (message && typeof message.getContact === "function") {
        const contact = await message.getContact();
        if (contact && contact.id && contact.id._serialized) {
          const contactId = contact.id._serialized;
          // If contact resolves to @lid, try to resolve to real @c.us for backend lookups
          if (contactId.endsWith("@lid") && client) {
            try {
              const resolved = await client.getContactById(contactId);
              senderNumber =
                (resolved && resolved.id && resolved.id._serialized) ||
                contactId;
            } catch (e) {
              senderNumber = contactId;
            }
          } else {
            senderNumber = contactId;
          }
        }
      }
    } catch (err) {
      // ignore
    }
    if (!senderNumber) {
      senderNumber = privateChatId || null;
    }

    // parse command body to extract confession text (remove leading /confissao)
    // Preserve original formatting (line breaks, quotes, spacing). Do not trim.
    const raw = (info && info.body) || (message && message.body) || "";
    // Remove only the leading command token 'confissao' (with or without diacritics
    // and optional leading slash) while preserving the rest of the original text.
    let text = raw;
    try {
      const firstTokMatch = raw.match(/^\s*(\/?\S+)/);
      if (firstTokMatch) {
        const firstTok = firstTokMatch[1]; // includes optional leading slash
        const deaccent = (s) =>
          String(s || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
        if (
          deaccent(firstTok.replace(/^\//, "").replace(/[:\s]+$/, "")) ===
          "confissao"
        ) {
          const start = raw.indexOf(firstTokMatch[1]) + firstTokMatch[1].length;
          text = raw.slice(start).replace(/^[\s:]+/, "");
        }
      }
    } catch (e) {
      // fallback: previous simple regex if anything goes wrong
      const cmdMatch = raw.match(/^\s*\/?confissao\b[:\s]*/i);
      text = cmdMatch ? raw.slice(cmdMatch[0].length) : raw;
    }

    if (!(text && text.trim().length) && !(message && message.hasMedia)) {
      await reply(
        "Uso: /confissao <sua mensagem>\nEx: /confissao confesso que...",
      );
      return;
    }

    // Marca cedo para o catchup não reprocessar o mesmo /confissao se o bot reiniciar antes do fim do fluxo (enquetes).
    if (msgIdSerialized) jsonStore.markProcessed(msgIdSerialized);

    // media helpers (images/videos) — implemented below

    // Find groups in common with the user by scanning bot chats and checking membership
    // Note: getChats() returns cached list of chat IDs, but we ALWAYS use getChatById()
    // to fetch fresh participant data for each group to avoid stale cache issues
    let chats = [];
    try {
      // Get list of all chats (cached IDs only - we'll refresh data for each group below)
      chats = await client.getChats();
    } catch (err) {
      console.error(
        "Erro ao listar chats do cliente:",
        err && err.message ? err.message : err,
      );
      await reply(
        "Não foi possível recuperar a lista de grupos no momento. Tente novamente mais tarde.",
      );
      return;
    }

    const chatCleaner = require("../../utils/chatCleaner");
    const candidateGroups = [];
    const botActiveGroupsList = []; // Lista de grupos onde o bot está ativo

    // Load ignored chats cache
    const ignoredChats = chatCleaner.loadIgnoredChats();

    // Get bot's own ID to verify membership
    let botId = null;
    try {
      if (client.info && client.info.wid && client.info.wid._serialized) {
        botId = client.info.wid._serialized;
      } else if (client.info && client.info.me && client.info.me._serialized) {
        botId = client.info.me._serialized;
      }
    } catch (err) {
      // ignore
    }

    // Count groups for logging
    const totalGroups = chats.filter(
      (c) =>
        !!c.isGroup ||
        (c.id &&
          c.id._serialized &&
          String(c.id._serialized).endsWith("@g.us")),
    ).length;

    let chatsDeleted = 0;
    let botNotInGroupCount = 0;

    for (const c of chats) {
      try {
        const chatId =
          c.id && c.id._serialized ? c.id._serialized : c.id || null;
        if (!chatId) continue;
        const isG = !!c.isGroup || String(chatId).endsWith("@g.us");
        if (!isG) continue;

        // Skip if already in ignored list
        if (ignoredChats.has(chatId)) {
          botNotInGroupCount++;
          continue;
        }

        // Always fetch fresh data via getChatById to verify bot is still in the group
        // If this fails, the group no longer exists or bot was removed - skip it entirely
        let participants = [];
        let full = null;
        try {
          full = await client.getChatById(chatId);
          participants = full && full.participants ? full.participants : [];
        } catch (e) {
          // getChatById failed: group doesn't exist or bot is not a member anymore
          botNotInGroupCount++;
          const groupName = c.name || chatId.split("@")[0];

          // Delete this chat to prevent it from appearing in future scans
          const deleted = await chatCleaner.archiveInactiveChat(
            c,
            chatId,
            "bot removed from group or group deleted",
          );
          if (deleted) {
            chatsDeleted++;
          }
          chatCleaner.addToIgnoredChats(chatId);
          continue;
        }

        if (!Array.isArray(participants) || participants.length === 0) {
          botNotInGroupCount++;
          const groupName = c.name || chatId.split("@")[0];

          // Delete chat since it has no participants
          const deleted = await chatCleaner.archiveInactiveChat(
            c,
            chatId,
            "no participants found",
          );
          if (deleted) {
            chatsDeleted++;
          }
          chatCleaner.addToIgnoredChats(chatId);
          continue;
        }

        const memberIds = participants
          .map((p) => (p && p.id && p.id._serialized ? p.id._serialized : null))
          .filter(Boolean);

        // CRITICAL: Verify bot is actually in the group's participant list
        if (botId && !memberIds.includes(botId)) {
          botNotInGroupCount++;
          const groupName =
            (full && full.name) || c.name || chatId.split("@")[0];

          // Delete this chat since bot is not a member
          const deleted = await chatCleaner.archiveInactiveChat(
            c,
            chatId,
            "bot not in participant list",
          );
          if (deleted) {
            chatsDeleted++;
          }
          chatCleaner.addToIgnoredChats(chatId);
          continue;
        }

        // Check if group has only bot alone or bot + 1 person (leave these groups)
        const participantCount = memberIds.length;
        if (participantCount <= 2) {
          botNotInGroupCount++;
          const groupName =
            (full && full.name) || c.name || chatId.split("@")[0];

          // Leave the group first
          try {
            if (full && typeof full.leave === "function") {
              await full.leave();
            }
          } catch (leaveError) {
            // ignore leave errors
          }

          // Then delete the chat
          const deleted = await chatCleaner.archiveInactiveChat(
            c,
            chatId,
            `group with only ${participantCount} participant(s)`,
          );
          if (deleted) {
            chatsDeleted++;
          }
          chatCleaner.addToIgnoredChats(chatId);
          continue;
        }

        if (memberIds.includes(senderNumber)) {
          // Get readable name from fresh data
          const name = (full && full.name) || chatId.split("@")[0];
          candidateGroups.push({ id: chatId, name });
        }

        // Add to bot's active groups list (only if passed all checks above)
        botActiveGroupsList.push({
          name: (full && full.name) || chatId.split("@")[0],
          id: chatId,
          participantCount: memberIds.length,
        });
      } catch (e) {
        // ignore per-chat errors
      }
    }

    const botActiveGroups = totalGroups - botNotInGroupCount;

    if (!candidateGroups.length) {
      await reply(
        "Não encontrei nenhum grupo em comum com você onde eu esteja presente. Peça ao administrador para adicionar o bot no grupo desejado.",
      );
      return;
    }

    // Helper: create a poll and await a single vote payload
    const polls = require("../../components/poll");
    const mediaHelper = require("../../utils/mediaHelper");
    const videoHelper = require("../../utils/videoHelper");
    const { MessageMedia } = require("whatsapp-web.js");

    const createPollPromise = (
      clientOrSender,
      chatId,
      title,
      options,
      opts = {},
    ) => {
      return new Promise(async (resolve, reject) => {
        try {
          const pollMsg = await polls.createPoll(
            clientOrSender,
            chatId,
            title,
            options,
            Object.assign({}, opts, {
              onVote: async (payload) => {
                // Resolve with both payload and pollMsg reference
                resolve({ payload, pollMsg });
              },
            }),
          );

          // If createPoll returned null, the poll failed to send — reject immediately
          if (!pollMsg) {
            reject(new Error(`[confissao] createPoll retornou null para "${title}" em ${chatId}`));
            return;
          }

          // Collect poll message for cleanup IMMEDIATELY after creation
          // store poll message and chatId for later cleanup
          pollMessages.push({ pollMsg, chatId });
          // Don't resolve here - wait for vote in onVote callback above
        } catch (err) {
          reject(err);
        }
      });
    };

    const buildUniqueGroupLabels = (groups) => {
      const counts = new Map();
      for (const group of groups) {
        const base = (group && (group.name || group.id)) || "Grupo";
        counts.set(base, (counts.get(base) || 0) + 1);
      }

      const seen = new Map();
      return groups.map((group) => {
        const base = (group && (group.name || group.id)) || "Grupo";
        const total = counts.get(base) || 0;
        if (total <= 1) return base;

        const next = (seen.get(base) || 0) + 1;
        seen.set(base, next);
        return `${base} (${next})`;
      });
    };

    // Helper: pick a group (returns chosen group object or null)
    const pickGroup = async () => {
      if (candidateGroups.length === 1) return candidateGroups[0];
      const labels = buildUniqueGroupLabels(candidateGroups);
      try {
        const _res = await createPollPromise(
          client,
          pollChatId,
          "Escolha o grupo para enviar sua confissão",
          labels,
          {},
        );
        const payload = _res && _res.payload ? _res.payload : _res;
        const pollMsgForPickGroup = _res && _res.pollMsg;
        const idx =
          (payload && payload.selectedIndexes && payload.selectedIndexes[0]) ||
          0;
        return candidateGroups[Number(idx)];
      } catch (e) {
        return null;
      }
    };

    // Helper: present participants in pages and let user pick one (returns {jid,name} or null)
    const pickParticipantFromGroup = async (
      groupId,
      participants,
      prompt,
      pageSize = 10,
    ) => {
      if (!Array.isArray(participants) || participants.length === 0)
        return null;
      // attempt to detect the bot's own JID to exclude it from options
      let botJid = null;
      try {
        if (client) {
          if (client.info && client.info.me && client.info.me._serialized)
            botJid = client.info.me._serialized;
          else if (client.info && client.info.wid)
            botJid = `${client.info.wid}@c.us`;
          else if (typeof client.getMe === "function") {
            try {
              const me = await client.getMe();
              if (me && me._serialized) botJid = me._serialized;
              else if (me && me.id && me.id._serialized)
                botJid = me.id._serialized;
            } catch (ee) {
              // ignore
            }
          }
        }
      } catch (e) {
        // ignore
      }

      // map to objects and try to resolve readable names via client.getContactById
      const items = await Promise.all(
        participants
          .filter((p) => {
            const jid = p && p.id && p.id._serialized ? p.id._serialized : p;
            if (!jid) return false;
            if (botJid && jid === botJid) return false; // exclude bot itself
            return true;
          })
          .map(async (p) => {
            const jid = p && p.id && p.id._serialized ? p.id._serialized : p;
            let name =
              (p && (p.name || (p.contact && p.contact.name))) ||
              (jid && jid.split("@")[0]) ||
              jid;
            try {
              if (client && typeof client.getContactById === "function") {
                const contact = await client.getContactById(jid);
                if (contact) {
                  if (contact.pushname) name = contact.pushname;
                  else if (contact.name) name = contact.name;
                  else if (contact.shortName) name = contact.shortName;
                }
              }
            } catch (e) {
              // ignore contact resolution failure and keep fallback name
            }
            return { jid, name };
          }),
      );

      let page = 0;
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

      while (true) {
        const start = page * pageSize;
        const slice = items.slice(start, start + pageSize);
        const options = slice.map((s) => s.name || s.jid);
        if (totalPages > 1) {
          if (page > 0) options.push("◀️ Anterior");
          if (page < totalPages - 1) options.push("▶️ Próxima");
          options.push("✖️ Cancelar");
        }

        let payload;
        try {
          const _res = await createPollPromise(
            client,
            pollChatId,
            prompt,
            options,
            {},
          );
          payload = _res && _res.payload ? _res.payload : _res;
          const pollMsgForPage = _res && _res.pollMsg;
        } catch (err) {
          return null;
        }

        if (!payload || !Array.isArray(payload.selectedNames)) return null;
        const selName = payload.selectedNames[0];
        if (!selName) return null;

        if (selName === "◀️ Anterior") {
          page = Math.max(0, page - 1);
          continue;
        }
        if (selName === "▶️ Próxima") {
          page = Math.min(totalPages - 1, page + 1);
          continue;
        }
        if (selName === "✖️ Cancelar") {
          return null;
        }

        // find selected item in current slice
        const found =
          slice.find((s) => s.name === selName) ||
          slice[Number(payload.selectedIndexes && payload.selectedIndexes[0])];
        if (found) return { jid: found.jid, name: found.name };
        return null;
      }
    };

    // Detect mention tokens in the text: occurrences of @ followed by non-space chars
    const mentionTokens = [];
    try {
      const regex = /@\S*/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        mentionTokens.push(m[0]);
      }
    } catch (e) {
      // ignore
    }

    // If there are mention tokens, ask the user whether to treat as mentions
    let mentionMap = []; // array of chosen jids in order
    if (mentionTokens.length > 0) {
      try {
        const _res = await createPollPromise(
          client,
          pollChatId,
          `Detectei ${mentionTokens.length} menção(ões) na sua mensagem. Deseja mencionar usuário(s)?`,
          ["Sim", "Não"],
          {},
        );
        const yn = _res && _res.payload ? _res.payload : _res;
        const pollMsgForMentions = _res && _res.pollMsg;
        const ynIdx =
          yn && yn.selectedIndexes && yn.selectedIndexes[0]
            ? yn.selectedIndexes[0]
            : 0;
        if (Number(ynIdx) === 0) {
          // proceed with mention flow
          const targetGroup = await pickGroup();
          if (!targetGroup) {
            await reply("Nenhum grupo selecionado. Enviando sem menções.");
          } else {
            // Get fresh participants from group (never use cached data)
            let fullChat = null;
            try {
              fullChat = await client.getChatById(targetGroup.id);
            } catch (e) {
              try {
                // Retry once on failure
                fullChat = await client.getChatById(targetGroup.id);
              } catch (ee) {
                fullChat = null;
              }
            }

            const participants = (fullChat && fullChat.participants) || [];

            // For each mention token, let user pick one participant
            for (let i = 0; i < mentionTokens.length; i++) {
              const tok = mentionTokens[i];
              const prompt = `Selecione o usuário para substituir ${tok} (menção ${
                i + 1
              }/${mentionTokens.length})`;
              const chosen = await pickParticipantFromGroup(
                targetGroup.id,
                participants,
                prompt,
                10,
              );
              if (!chosen) {
                // user cancelled selection — abort mention flow
                mentionMap = [];
                break;
              }
              mentionMap.push(chosen);
            }

            // If we completed selections, substitute tokens in text in order
            if (mentionMap.length === mentionTokens.length) {
              // Replace each @-token in-order by using replace with a callback,
              // which guarantees we consume mentionMap sequentially even when
              // tokens are identical (eg. multiple lone "@" placeholders).
              let idx = 0;
              const replacedText = text.replace(/@\S*/g, (match) => {
                const entry = mentionMap[idx++];
                const jid = entry && entry.jid;
                const phone = jid ? jid.split("@")[0] : null;
                return phone ? `@${phone}` : match;
              });

              // send to group with mentions list (preserve the same order)
              try {
                const groupMsg = `*📩 Confissão:* ${replacedText}`;
                if (message && message.hasMedia) {
                  try {
                    const media =
                      await mediaHelper.obterMidiaDaMensagem(message);
                    if (
                      media &&
                      media.mimetype &&
                      media.mimetype.startsWith("image")
                    ) {
                      // whatsapp-web.js expects a MessageMedia instance for binary images
                      const base64 =
                        media.base64 || media.buffer.toString("base64");
                      const mm = new MessageMedia(
                        media.mimetype || "image/jpeg",
                        base64,
                        media.filename || "image.jpg",
                      );
                      await client.sendMessage(targetGroup.id, mm, {
                        caption: groupMsg,
                        mentions: mentionMap.map((m) => m.jid),
                      });
                    } else if (
                      media &&
                      media.mimetype &&
                      media.mimetype.startsWith("video")
                    ) {
                      // Videos may not be supported by the Chromium instance (codecs).
                      // Ask the user if they want the original message forwarded to the target group instead.
                      try {
                        const _res = await createPollPromise(
                          client,
                          pollChatId,
                          "Detectei um vídeo. Vídeos não são suportados neste ambiente. Deseja que eu encaminhe sua mensagem original para o grupo selecionado?",
                          ["Sim", "Não"],
                          {},
                        );
                        const yn = _res && _res.payload ? _res.payload : _res;
                        const pollMsgForVideo = _res && _res.pollMsg;
                        const ynIdx =
                          yn && yn.selectedIndexes && yn.selectedIndexes[0]
                            ? yn.selectedIndexes[0]
                            : 0;
                        if (Number(ynIdx) === 0) {
                          // forward original message
                          try {
                            const mid =
                              message &&
                              message.id &&
                              (message.id._serialized || message.id.id);
                            if (
                              client &&
                              typeof client.forwardMessages === "function" &&
                              mid
                            ) {
                              await client.forwardMessages(targetGroup.id, [
                                mid,
                              ]);
                              // After forwarding the media, send the confession text separately
                              await client.sendMessage(
                                targetGroup.id,
                                groupMsg,
                                {
                                  mentions: mentionMap.map((m) => m.jid),
                                },
                              );
                            } else if (typeof message.forward === "function") {
                              await message.forward(targetGroup.id);
                              await client.sendMessage(
                                targetGroup.id,
                                groupMsg,
                                {
                                  mentions: mentionMap.map((m) => m.jid),
                                },
                              );
                            } else {
                              throw new Error("forward-not-supported");
                            }
                          } catch (fwdErr) {
                            console.error(
                              "[confissao] falha ao encaminhar vídeo:",
                              fwdErr && fwdErr.message
                                ? fwdErr.message
                                : fwdErr,
                            );
                            await reply(
                              "Não consegui encaminhar a mensagem original. Enviando sem mídia.",
                            );
                            await client.sendMessage(targetGroup.id, groupMsg, {
                              mentions: mentionMap.map((m) => m.jid),
                            });
                          }
                        } else {
                          // user chose not to forward — send text only
                          await client.sendMessage(targetGroup.id, groupMsg, {
                            mentions: mentionMap.map((m) => m.jid),
                          });
                        }
                      } catch (e) {
                        console.error(
                          "[confissao] erro ao perguntar sobre encaminhar vídeo:",
                          e && e.message ? e.message : e,
                        );
                        await client.sendMessage(targetGroup.id, groupMsg, {
                          mentions: mentionMap.map((m) => m.jid),
                        });
                      }
                    } else {
                      // fallback: send as text
                      await client.sendMessage(targetGroup.id, groupMsg, {
                        mentions: mentionMap.map((m) => m.jid),
                      });
                    }
                  } catch (e) {
                    console.error(
                      "[confissao] erro ao processar mídia para envio:",
                      e && e.message ? e.message : e,
                    );
                    await reply(
                      "Não foi possível processar a mídia da sua confissão. Enviando sem mídia.",
                    );
                    await client.sendMessage(targetGroup.id, groupMsg, {
                      mentions: mentionMap.map((m) => m.jid),
                    });
                  }
                } else {
                  await client.sendMessage(targetGroup.id, groupMsg, {
                    mentions: mentionMap.map((m) => m.jid),
                  });
                }
              } catch (err) {
                console.error(
                  "Erro ao enviar confissão com menções:",
                  err && err.message ? err.message : err,
                );
                await reply(
                  "Ocorreu um erro ao enviar a confissão ao grupo com menções. Tente novamente mais tarde.",
                );
                return;
              }

              // consume balance
              try {
                let consumeResult;
                try {
                  consumeResult = await consumeConfessionBalance(
                    services.backend,
                    senderNumber,
                  );
                } catch (err) {
                  console.error(
                    "Erro ao notificar backend sobre consumo de confissão (menção):",
                    err && err.message ? err.message : err,
                  );
                  try {
                    await reply(
                      "✅ Confissão enviada. O servidor não conseguiu atualizar o saldo agora (rede ou erro temporário). O envio ao grupo já foi feito — tenta mais tarde se o saldo não bater certo.",
                    );
                  } catch (e) {}
                  return;
                }

                try {
                  const remaining = consumeResult.ok
                    ? consumeResult.remaining
                    : null;
                  const isVip =
                    consumeResult.ok &&
                    (remaining === null ||
                      remaining === Infinity ||
                      String(remaining).toLowerCase() === "infinity");
                  let confirmMsg;
                  if (consumeResult.ok && isVip) {
                    confirmMsg = await reply(
                      "*🎉 Sua confissão foi enviada anonimamente com sucesso!* \n\n🙏 Você possui confissões vitalícias — não será debitado. 💸",
                    );
                  } else if (consumeResult.ok) {
                    confirmMsg = await reply(
                      `*✅ Sua confissão foi enviada anonimamente com sucesso!* \n\n📩 *Enviada para:* ${
                        targetGroup.name
                      }\n${linhaSaldoRestante(remaining)}`,
                    );
                  } else if (
                    consumeResult.reason === "insufficient_balance"
                  ) {
                    confirmMsg = await reply(
                      `⚠️ Sua confissão foi enviada ao grupo ${targetGroup.name}, porém seu saldo está insuficiente para futuras confissões.`,
                    );
                  } else if (consumeResult.reason === "user_not_found") {
                    confirmMsg = await reply(
                      `✅ Confissão enviada ao grupo ${targetGroup.name}.\n\n⚠️ Não encontrámos a tua conta no sistema para debitar/atualizar o saldo. Se deves ter saldo, contacta um administrador.`,
                    );
                  } else {
                    confirmMsg = await reply(
                      `✅ Confissão enviada ao grupo ${targetGroup.name}. Não foi possível confirmar o saldo no momento.`,
                    );
                  }
                  await cleanupAfterConfession(message, confirmMsg);
                } catch (e) {
                  // ignore reply errors
                }
              } catch (err) {
                console.error(
                  "Erro ao notificar backend sobre consumo de confissão (menção):",
                  err && err.message ? err.message : err,
                );
              }

              return;
            }
          }
        }
      } catch (e) {
        console.error(
          "[confissao] erro ao criar enquete de menção:",
          e && e.message ? e.message : e,
        );
        try {
          await reply(
            "Não foi possível criar a enquete para menções. Enviando sem menções.",
          );
        } catch (repErr) {}
        // continue to normal flow
      }
    }

    // If no mentions or mention flow aborted, continue to regular group selection/send below

    // If there's exactly one group in common, skip the poll and send directly
    if (candidateGroups.length === 1) {
      const target = candidateGroups[0];
      try {
        const groupMsg = `*📩 Confissão:* ${text}`;
        if (message && message.hasMedia) {
          try {
            const media = await mediaHelper.obterMidiaDaMensagem(message);
            if (media && media.mimetype && media.mimetype.startsWith("image")) {
              const base64 = media.base64 || media.buffer.toString("base64");
              const mm = new MessageMedia(
                media.mimetype || "image/jpeg",
                base64,
                media.filename || "image.jpg",
              );
              await client.sendMessage(target.id, mm, { caption: groupMsg });
            } else if (
              media &&
              media.mimetype &&
              media.mimetype.startsWith("video")
            ) {
              // Ask the user whether to forward original message because video sending
              // may not be supported by the environment (Chromium codecs).
              try {
                const _res = await createPollPromise(
                  client,
                  pollChatId,
                  "Detectei um vídeo. Vídeos não são suportados neste ambiente. Deseja que eu encaminhe sua mensagem original para o grupo?",
                  ["Sim", "Não"],
                  {},
                );
                const yn = _res && _res.payload ? _res.payload : _res;
                const pollMsgForVideo2 = _res && _res.pollMsg;
                const ynIdx =
                  yn && yn.selectedIndexes && yn.selectedIndexes[0]
                    ? yn.selectedIndexes[0]
                    : 0;
                if (Number(ynIdx) === 0) {
                  try {
                    const mid =
                      message &&
                      message.id &&
                      (message.id._serialized || message.id.id);
                    if (
                      client &&
                      typeof client.forwardMessages === "function" &&
                      mid
                    ) {
                      await client.forwardMessages(target.id, [mid]);
                      // send confession text separately after forward
                      await client.sendMessage(target.id, groupMsg);
                    } else if (typeof message.forward === "function") {
                      await message.forward(target.id);
                      await client.sendMessage(target.id, groupMsg);
                    } else {
                      throw new Error("forward-not-supported");
                    }
                  } catch (fwdErr) {
                    console.error(
                      "[confissao] falha ao encaminhar vídeo (único grupo):",
                      fwdErr && fwdErr.message ? fwdErr.message : fwdErr,
                    );
                    await reply(
                      "Não consegui encaminhar a mensagem original. Enviando sem mídia.",
                    );
                    await client.sendMessage(target.id, groupMsg);
                  }
                } else {
                  await client.sendMessage(target.id, groupMsg);
                }
              } catch (e) {
                console.error(
                  "[confissao] erro ao perguntar sobre encaminhar vídeo (único grupo):",
                  e && e.message ? e.message : e,
                );
                await client.sendMessage(target.id, groupMsg);
              }
            } else {
              await client.sendMessage(target.id, groupMsg);
            }
          } catch (e) {
            console.error(
              "[confissao] erro ao processar mídia (único grupo):",
              e && e.message ? e.message : e,
            );
            await client.sendMessage(target.id, groupMsg);
          }
        } else {
          await client.sendMessage(target.id, groupMsg);
        }
      } catch (err) {
        console.error(
          "Erro ao enviar confissão ao grupo (único grupo):",
          err && err.message ? err.message : err,
        );
        await reply(
          "Ocorreu um erro ao enviar a confissão ao grupo. Tente novamente mais tarde.",
        );
        return;
      }

      // consume balance
      try {
        let consumeResult;
        try {
          consumeResult = await consumeConfessionBalance(
            services.backend,
            senderNumber,
          );
        } catch (err) {
          console.error(
            "Erro ao notificar backend sobre consumo de confissão (único grupo):",
            err && err.message ? err.message : err,
          );
          try {
            await reply(
              "✅ Confissão enviada. O servidor não conseguiu atualizar o saldo agora (rede ou erro temporário). O envio ao grupo já foi feito — tenta mais tarde se o saldo não bater certo.",
            );
          } catch (e) {}
          return;
        }

        try {
          const remaining = consumeResult.ok
            ? consumeResult.remaining
            : null;
          const isVip =
            consumeResult.ok &&
            (remaining === null ||
              remaining === Infinity ||
              String(remaining).toLowerCase() === "infinity");
          let confirmMsg;
          if (consumeResult.ok && isVip) {
            confirmMsg = await reply(
              "*🎉 Sua confissão foi enviada anonimamente com sucesso!* \n\n🙏 Você possui confissões vitalícias — não será debitado. 💸",
            );
          } else if (consumeResult.ok) {
            confirmMsg = await reply(
              `*✅ Sua confissão foi enviada anonimamente com sucesso!* \n\n📩 *Enviada para:* ${
                target.name
              }\n${linhaSaldoRestante(remaining)}`,
            );
          } else if (consumeResult.reason === "insufficient_balance") {
            confirmMsg = await reply(
              `⚠️ Sua confissão foi enviada ao grupo ${target.name}, porém seu saldo está insuficiente para futuras confissões.`,
            );
          } else if (consumeResult.reason === "user_not_found") {
            confirmMsg = await reply(
              `✅ Confissão enviada ao grupo ${target.name}.\n\n⚠️ Não encontrámos a tua conta no sistema para debitar/atualizar o saldo. Se deves ter saldo, contacta um administrador.`,
            );
          } else {
            confirmMsg = await reply(
              `✅ Confissão enviada ao grupo ${target.name}. Não foi possível confirmar o saldo no momento.`,
            );
          }
          await cleanupAfterConfession(message, confirmMsg);
        } catch (e) {
          // ignore reply errors
        }
      } catch (err) {
        console.error(
          "Erro ao notificar backend sobre consumo de confissão (único grupo):",
          err && err.message ? err.message : err,
        );
      }

      return;
    }

    // Build poll options (labels) and keep mapping to chat ids
    const optionLabels = buildUniqueGroupLabels(candidateGroups);
    const optionChatIds = candidateGroups.map((g) => g.id);

    try {
      // create a poll in the user's private chat to choose target group
      const pollResult = await createPollPromise(
        client,
        pollChatId,
        "Escolha o grupo para enviar sua confissão",
        optionLabels,
        {},
      );

      // Extract payload from result
      const payload =
        pollResult && pollResult.payload ? pollResult.payload : pollResult;

      try {
        const idxs =
          payload && payload.selectedIndexes ? payload.selectedIndexes : [];
        if (!idxs || !idxs.length) return;
        const pick = Number(idxs[0]);
        const targetChat = optionChatIds[pick];
        if (!targetChat) return;

        const pickedGroupName =
          candidateGroups[pick] && candidateGroups[pick].name
            ? candidateGroups[pick].name
            : targetChat;

        // send confession to selected group (formatted)
        try {
          const groupMsg = `*📩 Confissão:* ${text}`;
          if (message && message.hasMedia) {
            try {
              const media = await mediaHelper.obterMidiaDaMensagem(message);
              if (
                media &&
                media.mimetype &&
                media.mimetype.startsWith("image")
              ) {
                const base64 = media.base64 || media.buffer.toString("base64");
                const mm = new MessageMedia(
                  media.mimetype || "image/jpeg",
                  base64,
                  media.filename || "image.jpg",
                );
                await client.sendMessage(targetChat, mm, {
                  caption: groupMsg,
                });
              } else if (
                media &&
                media.mimetype &&
                media.mimetype.startsWith("video")
              ) {
                // Ask the user whether to forward original message because video sending
                // may not be supported by the environment (Chromium codecs).
                try {
                  const _res = await createPollPromise(
                    client,
                    pollChatId,
                    "Detectei um vídeo. Vídeos não são suportados neste ambiente. Deseja que eu encaminhe sua mensagem original para o grupo selecionado?",
                    ["Sim", "Não"],
                    {},
                  );
                  const yn = _res && _res.payload ? _res.payload : _res;
                  const pollMsgForVideo3 = _res && _res.pollMsg;
                  const ynIdx =
                    yn && yn.selectedIndexes && yn.selectedIndexes[0]
                      ? yn.selectedIndexes[0]
                      : 0;
                  if (Number(ynIdx) === 0) {
                    try {
                      const mid =
                        message &&
                        message.id &&
                        (message.id._serialized || message.id.id);
                      if (
                        client &&
                        typeof client.forwardMessages === "function" &&
                        mid
                      ) {
                        await client.forwardMessages(targetChat, [mid]);
                        // send confession text separately after forward
                        await client.sendMessage(targetChat, groupMsg);
                      } else if (typeof message.forward === "function") {
                        await message.forward(targetChat);
                        await client.sendMessage(targetChat, groupMsg);
                      } else {
                        throw new Error("forward-not-supported");
                      }
                    } catch (fwdErr) {
                      console.error(
                        "[confissao] falha ao encaminhar vídeo (enquete):",
                        fwdErr && fwdErr.message ? fwdErr.message : fwdErr,
                      );
                      await reply(
                        "Não consegui encaminhar a mensagem original. Enviando sem mídia.",
                      );
                      await client.sendMessage(targetChat, groupMsg);
                    }
                  } else {
                    await client.sendMessage(targetChat, groupMsg);
                  }
                } catch (e) {
                  console.error(
                    "[confissao] erro ao perguntar sobre encaminhar vídeo (enquete):",
                    e && e.message ? e.message : e,
                  );
                  await client.sendMessage(targetChat, groupMsg);
                }
              } else {
                await client.sendMessage(targetChat, groupMsg);
              }
            } catch (e) {
              console.error(
                "[confissao] erro ao processar mídia (enquete):",
                e && e.message ? e.message : e,
              );
              await client.sendMessage(targetChat, groupMsg);
            }
          } else {
            await client.sendMessage(targetChat, groupMsg);
          }
        } catch (err) {
          console.error(
            "Erro ao enviar confissão ao grupo selecionado:",
            err && err.message ? err.message : err,
          );
          // notify user privately about failure
          try {
            await reply(
              "Ocorreu um erro ao enviar a confissão ao grupo selecionado.",
            );
          } catch (e) {}
          return;
        }

        // notify backend to consume balance
        try {
          let consumeResult;
          try {
            consumeResult = await consumeConfessionBalance(
              services.backend,
              senderNumber,
            );
          } catch (err) {
            console.error(
              "Erro ao notificar backend sobre consumo de confissão:",
              err && err.message ? err.message : err,
            );
            try {
              await reply(
                "✅ Confissão enviada. O servidor não conseguiu atualizar o saldo agora (rede ou erro temporário). O envio ao grupo já foi feito — tenta mais tarde se o saldo não bater certo.",
              );
            } catch (e) {}
            return;
          }

          const pickedName = candidateGroups[pick].name;
          try {
            const remaining = consumeResult.ok
              ? consumeResult.remaining
              : null;
            const isVip =
              consumeResult.ok &&
              (remaining === null ||
                remaining === Infinity ||
                String(remaining).toLowerCase() === "infinity");
            let confirmMsg;
            if (consumeResult.ok && isVip) {
              confirmMsg = await reply(
                "*🎉 Sua confissão foi enviada anonimamente com sucesso!* \n\n🙏 Você possui confissões vitalícias — não será debitado. 💸",
              );
            } else if (consumeResult.ok) {
              confirmMsg = await reply(
                `*✅ Sua confissão foi enviada anonimamente com sucesso!* \n\n📩 *Enviada para:* ${pickedName}\n${linhaSaldoRestante(
                  remaining,
                )}`,
              );
            } else if (consumeResult.reason === "insufficient_balance") {
              confirmMsg = await reply(
                `⚠️ Sua confissão foi enviada ao grupo ${pickedName}, porém seu saldo está insuficiente para futuras confissões.`,
              );
            } else if (consumeResult.reason === "user_not_found") {
              confirmMsg = await reply(
                `✅ Confissão enviada ao grupo ${pickedName}.\n\n⚠️ Não encontrámos a tua conta no sistema para debitar/atualizar o saldo. Se deves ter saldo, contacta um administrador.`,
              );
            } else {
              confirmMsg = await reply(
                `✅ Confissão enviada ao grupo ${pickedName}. Não foi possível confirmar o saldo no momento.`,
              );
            }
            await cleanupAfterConfession(message, confirmMsg);
          } catch (e) {}
        } catch (err) {
          console.error(
            "Erro ao notificar backend sobre consumo de confissão:",
            err && err.message ? err.message : err,
          );
        }
      } catch (err) {
        console.error(
          "Erro ao processar voto da confissão:",
          err && err.message ? err.message : err,
        );
      }
    } catch (err) {
      console.error(
        "Erro ao criar enquete para seleção de grupo:",
        err && err.message ? err.message : err,
      );
      await reply(
        "Não foi possível criar a enquete de seleção de grupo. Tente novamente mais tarde.",
      );
    }
  },
};
