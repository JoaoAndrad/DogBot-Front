module.exports = {
  name: "confissao",
  description:
    "Enviar uma confissão anonimamente para o grupo configurado (privado apenas).",
  async execute(ctx) {
    const { message, info, reply, client, services } = ctx;

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

    if (!text && !(message && message.hasMedia)) {
      await reply(
        "Uso: /confissao <sua mensagem>\nEx: /confissao confesso que..."
      );
      return;
    }

    // media helpers (images/videos) — implemented below

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
      opts = {}
    ) => {
      return new Promise(async (resolve, reject) => {
        try {
          await polls.createPoll(
            clientOrSender,
            chatId,
            title,
            options,
            Object.assign({}, opts, {
              onVote: async (payload) => {
                resolve(payload);
              },
            })
          );
        } catch (err) {
          reject(err);
        }
      });
    };

    // Helper: pick a group (returns chosen group object or null)
    const pickGroup = async () => {
      if (candidateGroups.length === 1) return candidateGroups[0];
      const labels = candidateGroups.map((g) => g.name || g.id);
      try {
        const payload = await createPollPromise(
          client,
          senderNumber,
          "Escolha o grupo para enviar sua confissão",
          labels,
          {}
        );
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
      pageSize = 10
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
          })
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
          payload = await createPollPromise(
            client,
            senderNumber,
            prompt,
            options,
            {}
          );
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

    console.log("[confissao] texto recebido:", text);
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
      console.log("[confissao] menções detectadas:", mentionTokens);
      try {
        const yn = await createPollPromise(
          client,
          senderNumber,
          `Detectei ${mentionTokens.length} menção(ões) na sua mensagem. Deseja mencionar usuário(s)?`,
          ["Sim", "Não"],
          {}
        );
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
            // get participants from group
            let fullChat = null;
            try {
              fullChat = await client.getChatById(targetGroup.id);
            } catch (e) {
              try {
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
                10
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
                    const media = await mediaHelper.obterMidiaDaMensagem(
                      message
                    );
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
                        media.filename || "image.jpg"
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
                        const yn = await createPollPromise(
                          client,
                          senderNumber,
                          "Detectei um vídeo. Vídeos não são suportados neste ambiente. Deseja que eu encaminhe sua mensagem original para o grupo selecionado?",
                          ["Sim", "Não"],
                          {}
                        );
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
                                }
                              );
                            } else if (typeof message.forward === "function") {
                              await message.forward(targetGroup.id);
                              await client.sendMessage(
                                targetGroup.id,
                                groupMsg,
                                {
                                  mentions: mentionMap.map((m) => m.jid),
                                }
                              );
                            } else {
                              throw new Error("forward-not-supported");
                            }
                          } catch (fwdErr) {
                            console.error(
                              "[confissao] falha ao encaminhar vídeo:",
                              fwdErr && fwdErr.message ? fwdErr.message : fwdErr
                            );
                            await reply(
                              "Não consegui encaminhar a mensagem original. Enviando sem mídia."
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
                          e && e.message ? e.message : e
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
                      e && e.message ? e.message : e
                    );
                    await reply(
                      "Não foi possível processar a mídia da sua confissão. Enviando sem mídia."
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
                  err && err.message ? err.message : err
                );
                await reply(
                  "Ocorreu um erro ao enviar a confissão ao grupo com menções. Tente novamente mais tarde."
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
                        targetGroup.name
                      }\n*Saldo restante:* ${remaining} confissão${
                        remaining === 1 ? "" : "ões"
                      }`
                    );
                  } else if (res && res.reason === "insufficient_balance") {
                    await reply(
                      `⚠️ Sua confissão foi enviada ao grupo ${targetGroup.name}, porém seu saldo está insuficiente para futuras confissões.`
                    );
                  } else {
                    await reply(
                      `✅ Confissão enviada ao grupo ${targetGroup.name}. Não foi possível atualizar seu saldo no momento.`
                    );
                  }
                } catch (e) {
                  // ignore reply errors
                }
              } catch (err) {
                console.error(
                  "Erro ao notificar backend sobre consumo de confissão (menção):",
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
          }
        }
      } catch (e) {
        console.error(
          "[confissao] erro ao criar enquete de menção:",
          e && e.message ? e.message : e
        );
        try {
          await reply(
            "Não foi possível criar a enquete para menções. Enviando sem menções."
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
                media.filename || "image.jpg"
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
                const yn = await createPollPromise(
                  client,
                  senderNumber,
                  "Detectei um vídeo. Vídeos não são suportados neste ambiente. Deseja que eu encaminhe sua mensagem original para o grupo?",
                  ["Sim", "Não"],
                  {}
                );
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
                      fwdErr && fwdErr.message ? fwdErr.message : fwdErr
                    );
                    await reply(
                      "Não consegui encaminhar a mensagem original. Enviando sem mídia."
                    );
                    await client.sendMessage(target.id, groupMsg);
                  }
                } else {
                  await client.sendMessage(target.id, groupMsg);
                }
              } catch (e) {
                console.error(
                  "[confissao] erro ao perguntar sobre encaminhar vídeo (único grupo):",
                  e && e.message ? e.message : e
                );
                await client.sendMessage(target.id, groupMsg);
              }
            } else {
              await client.sendMessage(target.id, groupMsg);
            }
          } catch (e) {
            console.error(
              "[confissao] erro ao processar mídia (único grupo):",
              e && e.message ? e.message : e
            );
            await client.sendMessage(target.id, groupMsg);
          }
        } else {
          await client.sendMessage(target.id, groupMsg);
        }
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
                if (message && message.hasMedia) {
                  try {
                    const media = await mediaHelper.obterMidiaDaMensagem(
                      message
                    );
                    if (
                      media &&
                      media.mimetype &&
                      media.mimetype.startsWith("image")
                    ) {
                      const base64 =
                        media.base64 || media.buffer.toString("base64");
                      const mm = new MessageMedia(
                        media.mimetype || "image/jpeg",
                        base64,
                        media.filename || "image.jpg"
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
                        const yn = await createPollPromise(
                          client,
                          senderNumber,
                          "Detectei um vídeo. Vídeos não são suportados neste ambiente. Deseja que eu encaminhe sua mensagem original para o grupo selecionado?",
                          ["Sim", "Não"],
                          {}
                        );
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
                              fwdErr && fwdErr.message ? fwdErr.message : fwdErr
                            );
                            await reply(
                              "Não consegui encaminhar a mensagem original. Enviando sem mídia."
                            );
                            await client.sendMessage(targetChat, groupMsg);
                          }
                        } else {
                          await client.sendMessage(targetChat, groupMsg);
                        }
                      } catch (e) {
                        console.error(
                          "[confissao] erro ao perguntar sobre encaminhar vídeo (enquete):",
                          e && e.message ? e.message : e
                        );
                        await client.sendMessage(targetChat, groupMsg);
                      }
                    } else {
                      await client.sendMessage(targetChat, groupMsg);
                    }
                  } catch (e) {
                    console.error(
                      "[confissao] erro ao processar mídia (enquete):",
                      e && e.message ? e.message : e
                    );
                    await client.sendMessage(targetChat, groupMsg);
                  }
                } else {
                  await client.sendMessage(targetChat, groupMsg);
                }
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
