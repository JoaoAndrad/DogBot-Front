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

      // Get chat ID if in group
      const chatId = ctx.message?.from || null;

      // Check for active jams in this chat/global
      const activeJamsResult = await backend.sendToBackend(
        `/api/jam/active?chatId=${chatId || ""}`,
        null,
        "GET",
      );

      if (!activeJamsResult.success) {
        await reply("❌ Erro ao buscar jams ativas. Tente novamente.");
        return;
      }

      const activeJams = activeJamsResult.jams || [];

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

      // There are active jams, show poll to user
      const jam = activeJams[0]; // For now, use first active jam
      const hostName =
        jam.host?.push_name || jam.host?.display_name || "Anônimo";
      const listenerCount =
        jam.listeners?.filter((l) => l.isActive)?.length || 0;

      // Create poll using WhatsApp poll feature
      const pollMessage = await ctx.message.reply(
        `🎵 *Já existe uma jam ativa!*\n\n` +
          `🎙️ Host: ${hostName}\n` +
          `👥 Ouvintes: ${listenerCount}\n` +
          (jam.currentTrackName
            ? `🎶 Tocando: ${jam.currentTrackName}\n`
            : "") +
          `\n*O que você quer fazer?*`,
        null,
        {
          poll: {
            name: "Escolha uma opção:",
            options: [
              "✅ Entrar na jam existente",
              "🎵 Criar minha própria jam",
            ],
            selectableCount: 1,
          },
        },
      );

      // Store poll context for later handling
      const pollBuilder = require("../../pollBuilder");
      pollBuilder.storePollContext(pollMessage.id._serialized, {
        type: "jam-decision",
        userId,
        chatId,
        existingJamId: jam.id,
        options: ["join", "create"],
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

    const { userId, existingJamId, options } = pollContext;
    const choice = options[selectedOption];

    if (choice === "join") {
      // Join existing jam
      try {
        const joinResult = await backend.sendToBackend(
          `/api/jam/${existingJamId}/join`,
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
    } else if (choice === "create") {
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
    }
  },
};
