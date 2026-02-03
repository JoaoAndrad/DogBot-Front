const backend = require("../../services/backendClient");
const polls = require("../../components/poll");

module.exports = {
  name: "jam",
  aliases: ["radio", "jam.criar"],
  description: "Cria ou entra em uma jam/rádio para ouvir música sincronizada",
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
      console.log("[jam] Failed to resolve contact:", err.message);
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
      // Resolve WhatsApp identifier to User UUID
      const userLookup = await backend.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(userId)}`,
        null,
        "GET",
      );

      if (!userLookup || !userLookup.found || !userLookup.userId) {
        await reply(
          "❌ Usuário não encontrado no sistema.\n\n" +
            "Você precisa estar registrado para usar jams.",
        );
        return;
      }

      // Use the actual User UUID from database
      const userUuid = userLookup.userId;

      // Check if user already has an active jam (as host or listener)
      const statusResult = await backend.sendToBackend(
        `/api/jam/user/${userUuid}/status`,
        null,
        "GET",
      );

      if (!statusResult.success) {
        await reply("❌ Erro ao verificar status da jam. Tente novamente.");
        return;
      }

      // User is already hosting
      if (statusResult.role === "host") {
        const jam = statusResult.jam;
        const listenerCount =
          jam.listeners?.filter((l) => l.isActive)?.length || 0;
        const listenerNames = jam.listeners
          ?.filter((l) => l.isActive)
          ?.map((l) => l.user.push_name || l.user.display_name || "Anônimo")
          ?.slice(0, 5)
          ?.join(", ");

        let msg = `🎵 *Você já está hospedando uma jam!*\n\n`;
        msg += `👥 Ouvintes: ${listenerCount}\n`;
        if (listenerNames) {
          msg += `${listenerNames}${listenerCount > 5 ? " e outros..." : ""}\n`;
        }
        msg += `\nEnvie */sair* para encerrar a jam.`;

        await reply(msg);
        return;
      }

      // User is already listening to a jam
      if (statusResult.role === "listener") {
        const jam = statusResult.jam;
        const hostName =
          jam.host?.push_name || jam.host?.display_name || "Anônimo";

        let msg = `🎧 *Você já está ouvindo a jam de ${hostName}*\n\n`;
        msg += `Envie */sair* para sair da jam.`;

        await reply(msg);
        return;
      }

      // Get chat ID and check if it's a group
      const chatId = ctx.message?.from || null;
      const isGroup = chatId && chatId.includes("@g.us");

      // Check for active jams (filtered by chat if in group)
      const activeJamsResult = await backend.sendToBackend(
        `/api/jam/active${isGroup ? `?chatId=${chatId}` : ""}`,
        null,
        "GET",
      );

      if (!activeJamsResult.success) {
        await reply("❌ Erro ao buscar jams ativas. Tente novamente.");
        return;
      }

      let activeJams = activeJamsResult.jams || [];

      // Filter jams by group members if in a group
      if (isGroup && activeJams.length > 0 && ctx.message?.getChat) {
        try {
          const chat = await ctx.message.getChat();
          const participants = chat.participants || [];
          const participantIds = participants.map((p) => p.id._serialized);

          // Filter jams where host is a member of this group
          activeJams = activeJams.filter(
            (jam) =>
              participantIds.includes(jam.hostUserId) || jam.chatId === chatId,
          );
        } catch (err) {
          console.log("[jam] Could not filter by group members:", err.message);
          // Continue with unfiltered jams
        }
      }

      // No active jams: ask confirmation via poll (only initiator can vote)
      if (activeJams.length === 0) {
        const chatId = ctx.message?.from || null;
        const hostWhatsAppId = userId; // original WhatsApp identifier (e.g., 5581...@c.us)

        try {
          // Confirmation poll — only the initiator's vote will be considered
          const confirmRes = await polls.createPoll(
            ctx.client,
            chatId,
            "Tem certeza que deseja iniciar uma jam?",
            ["✅ Sim, iniciar", "❌ Não"],
            {
              onVote: async (voteData) => {
                try {
                  const voter = voteData.voter;
                  // Only the initiator may vote on this confirmation poll
                  if (voter !== hostWhatsAppId) {
                    // ignore other voters
                    return;
                  }

                  const selectedIndex =
                    (voteData.selectedIndexes && voteData.selectedIndexes[0]) ||
                    null;

                  if (selectedIndex !== 0) {
                    // User cancelled
                    await ctx.client.sendMessage(
                      chatId,
                      "Operação cancelada pelo usuário.",
                    );
                    return;
                  }

                  // User confirmed — create jam via backend
                  const createResult = await backend.sendToBackend(
                    "/api/jam/create",
                    { userId: userUuid, chatId },
                    "POST",
                  );

                  if (!createResult.success) {
                    if (createResult.error === "USER_ALREADY_HOSTING") {
                      await ctx.client.sendMessage(
                        chatId,
                        "❌ Você já está hospedando uma jam ativa.",
                      );
                      return;
                    }
                    await ctx.client.sendMessage(
                      chatId,
                      `❌ Erro ao criar jam: ${createResult.message || createResult.error}`,
                    );
                    return;
                  }

                  const jam = createResult.jam;

                  // Announce jam created in chat
                  let announce = `🎵 *Jam criada com sucesso!*\n\n`;
                  announce += `Você está transmitindo sua música para outros usuários.\n`;
                  announce += `Outros podem digitar */jam* para entrar.\n\n`;
                  if (jam.currentTrackName) {
                    announce += `🎶 Tocando agora: *${jam.currentTrackName}*\n`;
                    if (jam.currentArtists)
                      announce += `👤 ${jam.currentArtists}\n`;
                  } else {
                    announce += `⚠️ Nenhuma música tocando no momento. Inicie uma música no Spotify!\n`;
                  }
                  announce += `\nEnvie */sair* para encerrar a jam.`;

                  await ctx.client.sendMessage(chatId, announce);

                  // After creating, send invite poll to let others join
                  try {
                    const inviteRes = await polls.createPoll(
                      ctx.client,
                      chatId,
                      `🎵 Jam de ${jam.host?.push_name || jam.host?.display_name || "Anônimo"} — Deseja entrar?`,
                      ["✅ Entrar", "❌ Ignorar"],
                      {
                        onVote: async (inviteVote) => {
                          try {
                            const voterId = inviteVote.voter;
                            // Ignore host's votes client-side
                            if (voterId === hostWhatsAppId) return;

                            // Only consider 'Entrar' (index 0)
                            const sel =
                              (inviteVote.selectedIndexes &&
                                inviteVote.selectedIndexes[0]) ||
                              null;
                            if (sel !== 0) return;

                            // Resolve voter to user UUID via backend lookup
                            const lookup = await backend.sendToBackend(
                              `/api/users/lookup?identifier=${encodeURIComponent(voterId)}`,
                              null,
                              "GET",
                            );

                            if (!lookup || !lookup.found || !lookup.userId) {
                              // Notify voter they must be registered
                              await ctx.client.sendMessage(
                                voterId,
                                "❌ Você precisa estar registrado no sistema para entrar em jams.",
                              );
                              return;
                            }

                            const voterUuid = lookup.userId;

                            // Call join endpoint
                            const joinRes = await backend.sendToBackend(
                              `/api/jam/${jam.id}/join`,
                              { userId: voterUuid },
                              "POST",
                            );

                            if (!joinRes.success) {
                              if (joinRes.error === "NO_ACTIVE_DEVICE") {
                                await ctx.client.sendMessage(
                                  voterId,
                                  "⚠️ Não foi possível sincronizar — abra o Spotify em qualquer dispositivo e tente novamente.",
                                );
                                return;
                              }
                              await ctx.client.sendMessage(
                                voterId,
                                `❌ Erro ao entrar na jam: ${joinRes.message || joinRes.error}`,
                              );
                              return;
                            }

                            // Success — send private confirmation with current track
                            const joinedJam = joinRes.jam || jam;
                            const hostName =
                              joinedJam.host?.push_name ||
                              joinedJam.host?.display_name ||
                              "Anônimo";
                            let confirmMsg = `🎧 Você entrou na jam de ${hostName}!\n\n`;
                            if (joinedJam.currentTrackName) {
                              confirmMsg += `🎶 Tocando: *${joinedJam.currentTrackName}*\n`;
                              if (joinedJam.currentArtists)
                                confirmMsg += `👤 ${joinedJam.currentArtists}\n`;
                            }
                            confirmMsg += `\nEnvie */sair* para sair da jam.`;

                            await ctx.client.sendMessage(voterId, confirmMsg);
                          } catch (ivErr) {
                            console.error(
                              "[jam] invite onVote error:",
                              ivErr && ivErr.message,
                            );
                          }
                        },
                      },
                    );

                    console.log(
                      "Invite poll sent:",
                      inviteRes && inviteRes.msgId,
                    );
                  } catch (invErr) {
                    console.error(
                      "[jam] Failed to send invite poll:",
                      invErr && invErr.message,
                    );
                  }
                } catch (err) {
                  console.error(
                    "[jam] confirm onVote error:",
                    err && err.message,
                  );
                }
              },
            },
          );

          console.log(
            "Confirmation poll sent:",
            confirmRes && confirmRes.msgId,
          );
        } catch (err) {
          console.error(
            "[jam] Error creating confirmation poll:",
            err && err.message,
          );
          await reply(`❌ Erro ao processar o pedido: ${err.message}`);
        }

        return;
      }

      // There are active jams, show unified poll with all options
      // Build poll options: one for each active jam + create new option
      const pollOptions = [];
      const jamIdMap = {}; // Map option index to jam ID or "create"

      // Add option for each active jam (limit to 10 to not overflow poll)
      const maxJams = Math.min(activeJams.length, 10);
      for (let i = 0; i < maxJams; i++) {
        const jam = activeJams[i];
        const hostName =
          jam.host?.push_name || jam.host?.display_name || "Anônimo";
        const listenerCount =
          jam.listeners?.filter((l) => l.isActive)?.length || 0;

        let optionText = `🎧 Entrar na jam de ${hostName}`;
        if (listenerCount > 0) {
          optionText += ` (${listenerCount} ${listenerCount === 1 ? "ouvinte" : "ouvintes"})`;
        }

        pollOptions.push(optionText);
        jamIdMap[i] = jam.id;
      }

      // Add "create new" option at the end
      pollOptions.push("🎵 Criar minha própria jam");
      jamIdMap[pollOptions.length - 1] = "create";

      // Build message with jam details
      let pollMessage = `🎵 *${activeJams.length === 1 ? "Há uma jam ativa!" : `Há ${activeJams.length} jams ativas!`}*\n\n`;

      for (let i = 0; i < maxJams; i++) {
        const jam = activeJams[i];
        const hostName =
          jam.host?.push_name || jam.host?.display_name || "Anônimo";
        const listenerCount =
          jam.listeners?.filter((l) => l.isActive)?.length || 0;

        pollMessage += `🎙️ *${hostName}*\n`;
        pollMessage += `👥 ${listenerCount} ${listenerCount === 1 ? "ouvinte" : "ouvintes"}\n`;
        if (jam.currentTrackName) {
          pollMessage += `🎶 ${jam.currentTrackName}\n`;
          if (jam.currentArtists) {
            pollMessage += `👤 ${jam.currentArtists}\n`;
          }
        }
        pollMessage += `\n`;
      }

      if (activeJams.length > maxJams) {
        pollMessage += `_...e mais ${activeJams.length - maxJams} ${activeJams.length - maxJams === 1 ? "jam" : "jams"}_\n\n`;
      }

      pollMessage += `*O que você quer fazer?*`;

      // Create poll using WhatsApp poll feature
      const pollReply = await ctx.message.reply(pollMessage, null, {
        poll: {
          name: "Escolha uma opção:",
          options: pollOptions,
          selectableCount: 1,
        },
      });

      // Store poll context for later handling
      const pollBuilder = require("../../pollBuilder");
      pollBuilder.storePollContext(pollReply.id._serialized, {
        type: "jam-decision",
        userId: userUuid, // Store the UUID, not the WhatsApp identifier
        chatId,
        jamIdMap, // Maps option index to jam ID or "create"
      });
    } catch (err) {
      console.error("[jam] Error:", err);
      await reply(`❌ Erro ao processar comando /jam: ${err.message}`);
    }
  },

  /**
   * Handle poll response for jam decision
   */
  async handlePollResponse(ctx, pollContext, selectedOption) {
    const reply =
      typeof ctx.reply === "function" ? ctx.reply : (t) => console.log(t);

    const { userId, jamIdMap } = pollContext;
    const selectedJamId = jamIdMap[selectedOption];

    // User chose to create new jam
    if (selectedJamId === "create") {
      // Create new jam
      try {
        const chatId = ctx.message?.from || null;
        const createResult = await backend.sendToBackend(
          "/api/jam/create",
          { userId, chatId },
          "POST",
        );

        if (!createResult.success) {
          await reply(
            `❌ Erro ao criar jam: ${createResult.message || createResult.error}`,
          );
          return;
        }

        const jam = createResult.jam;
        let msg = `🎵 *Jam criada com sucesso!*\n\n`;
        msg += `Você está transmitindo sua música para outros usuários.\n`;

        if (jam.currentTrackName) {
          msg += `🎶 Tocando agora: *${jam.currentTrackName}*\n`;
          if (jam.currentArtists) {
            msg += `👤 ${jam.currentArtists}\n`;
          }
        }

        msg += `\nEnvie */sair* para encerrar a jam.`;

        await reply(msg);
      } catch (err) {
        console.error("[jam] Error creating:", err);
        await reply(`❌ Erro ao criar jam: ${err.message}`);
      }
      return;
    }

    // User chose to join an existing jam
    try {
      const joinResult = await backend.sendToBackend(
        `/api/jam/${selectedJamId}/join`,
        { userId },
        "POST",
      );

      if (!joinResult.success) {
        if (joinResult.error === "NO_ACTIVE_DEVICE") {
          await reply(
            "❌ *Não foi possível sincronizar*\n\n" +
              "Você precisa ter o Spotify aberto em qualquer dispositivo para entrar na jam.\n\n" +
              "📱 Abra o Spotify e tente novamente.",
          );
          return;
        }
        await reply(
          `❌ Erro ao entrar na jam: ${joinResult.message || joinResult.error}`,
        );
        return;
      }

      const jam = joinResult.jam;
      const hostName =
        jam.host?.push_name || jam.host?.display_name || "Anônimo";

      let msg = `🎧 *Você entrou na jam de ${hostName}!*\n\n`;

      if (joinResult.synced) {
        msg += `✅ Sua música foi sincronizada\n`;
        if (jam.currentTrackName) {
          msg += `🎶 Tocando: *${jam.currentTrackName}*\n`;
          if (jam.currentArtists) {
            msg += `👤 ${jam.currentArtists}\n`;
          }
        }
      } else {
        msg += `⚠️ Não foi possível sincronizar automaticamente.\n`;
        msg += `Certifique-se de que o Spotify está aberto.\n`;
      }

      msg += `\nEnvie */sair* para sair da jam.`;

      await reply(msg);
    } catch (err) {
      console.error("[jam] Error joining:", err);
      await reply(`❌ Erro ao entrar na jam: ${err.message}`);
    }
  },
};
