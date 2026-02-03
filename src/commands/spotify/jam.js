const backend = require("../../services/backendClient");

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
      // Check if user already has an active jam (as host or listener)
      const statusResult = await backend.sendToBackend(
        `/api/jam/user/${userId}/status`,
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

      // No active jams, create new one
      if (activeJams.length === 0) {
        const createResult = await backend.sendToBackend(
          "/api/jam/create",
          { userId, chatId },
          "POST",
        );

        if (!createResult.success) {
          if (createResult.error === "USER_ALREADY_HOSTING") {
            await reply("❌ Você já está hospedando uma jam ativa.");
            return;
          }
          await reply(
            `❌ Erro ao criar jam: ${createResult.message || createResult.error}`,
          );
          return;
        }

        const jam = createResult.jam;
        let msg = `🎵 *Jam criada com sucesso!*\n\n`;
        msg += `Você está transmitindo sua música para outros usuários.\n`;
        msg += `Outros podem digitar */jam* para entrar.\n\n`;

        if (jam.currentTrackName) {
          msg += `🎶 Tocando agora: *${jam.currentTrackName}*\n`;
          if (jam.currentArtists) {
            msg += `👤 ${jam.currentArtists}\n`;
          }
        } else {
          msg += `⚠️ Nenhuma música tocando no momento. Inicie uma música no Spotify!\n`;
        }

        msg += `\nEnvie */sair* para encerrar a jam.`;

        await reply(msg);
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
        userId,
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
