const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "playlist",
  aliases: ["pl"],
  description: "Configurar ou ver a playlist compartilhada do grupo",

  async execute(ctx) {
    const { message, reply } = ctx;
    const msg = message;
    const chatId = msg.from;

    // Check if is group: either msg.isGroup or chatId ends with @g.us
    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));
    const args = (msg.body || "").trim().split(/\s+/).slice(1);

    logger.debug(
      `[Playlist] isGroup=${isGroup}, chatId=${chatId}, msg.isGroup=${msg?.isGroup}`
    );

    if (!isGroup) {
      return reply("⚠️ Este comando só funciona em grupos.");
    }

    try {
      // Get group info
      logger.debug(`[Playlist] Buscando info do grupo ${chatId}`);
      const groupRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}`,
        null,
        "GET"
      );

      logger.debug(`[Playlist] Resposta do grupo:`, groupRes);

      const group = groupRes?.group;

      // No args: show current playlist
      if (args.length === 0) {
        if (!group || !group.playlistId) {
          return reply(
            "⚠️ Este grupo ainda não tem uma playlist configurada.\n\n" +
              "Para configurar, use:\n" +
              "/playlist set <spotify_playlist_id>\n\n" +
              "Exemplo:\n" +
              "/playlist set 37i9dQZF1DXcBWIGoYBM5M"
          );
        }

        const playlist = group.playlist;

        if (!playlist || !playlist.spotifyId) {
          return reply(
            "⚠️ Este grupo ainda não tem uma playlist configurada. Use /playlist set <spotify_playlist_id>"
          );
        }

        // Construct Spotify URL
        const spotifyUrl = `https://open.spotify.com/playlist/${playlist.spotifyId}`;

        // Prepare minimal info: name and link
        const out = `🎵 Playlist do Grupo:\n\nNome: ${
          playlist.name || "Sem nome"
        }\n🔗: ${spotifyUrl}`;

        // Send message first (use client.sendMessage to ensure ordering)
        try {
          if (
            ctx &&
            ctx.client &&
            typeof ctx.client.sendMessage === "function"
          ) {
            await ctx.client.sendMessage(chatId, out);
          } else {
            await reply(out);
          }
        } catch (e) {
          logger.warn(
            "[Playlist] failed to send message reply:",
            e && e.message
          );
        }

        // Then send playlist cover as sticker (best-effort)
        try {
          const stickerHelper = require("../../utils/media/stickerHelper");
          const trackLike = {
            image: playlist.coverUrl,
            trackName: playlist.name,
            trackId: playlist.spotifyId,
          };
          await stickerHelper.sendTrackSticker(ctx.client, chatId, trackLike);
        } catch (e) {
          logger.warn(
            "[Playlist] failed to send cover sticker:",
            e && e.message
          );
        }

        return;
      }

      // Command: set <playlistId>
      if (args[0] === "set" && args[1]) {
        // Extract playlist ID (remove query params if present)
        let spotifyPlaylistId = args[1];
        if (spotifyPlaylistId.includes("?")) {
          spotifyPlaylistId = spotifyPlaylistId.split("?")[0];
        }

        logger.info(
          `[Playlist] Vinculando playlist ${spotifyPlaylistId} ao grupo ${chatId}`
        );

        // Get user info
        const author = msg.author || msg.from;
        let userId = null;

        try {
          const contact = await msg.getContact();
          if (contact && contact.id && contact.id._serialized) {
            userId = contact.id._serialized;
          }
        } catch (err) {
          userId = author;
        }

        // Resolve userId to UUID and get Spotify account
        const userRes = await backendClient.sendToBackend(
          `/api/users/by-identifier/${encodeURIComponent(userId)}`,
          null,
          "GET"
        );

        if (!userRes || !userRes.user) {
          return reply(
            "❌ Você precisa estar cadastrado para configurar playlist."
          );
        }

        const user = userRes.user;
        logger.debug(`[Playlist] User:`, user);

        // Check if user has Spotify account
        if (!user.spotifyAccounts || user.spotifyAccounts.length === 0) {
          return reply(
            "❌ Você precisa conectar sua conta Spotify primeiro. Use /conectar"
          );
        }

        const spotifyAccount = user.spotifyAccounts[0];

        // Link existing playlist
        const linkRes = await backendClient.sendToBackend(
          `/api/groups/${encodeURIComponent(chatId)}/playlist/link`,
          {
            spotifyPlaylistId,
            accountId: spotifyAccount.id,
          }
        );

        if (linkRes && linkRes.success) {
          return reply(
            `✅ Playlist vinculada ao grupo!\n\n` +
              `🎵 ${linkRes.playlist.name}\n` +
              `${linkRes.playlist.description || ""}\n\n` +
              `Agora o grupo pode votar para adicionar músicas usando /voto\n\n` +
              `🔗 ${linkRes.spotifyUrl || ""}`
          );
        } else {
          return reply(
            `❌ Erro ao vincular playlist: ${
              linkRes?.error || "Erro desconhecido"
            }`
          );
        }
      }

      // Command: create <name>
      if (args[0] === "create" && args.length > 1) {
        const playlistName = args.slice(1).join(" ");

        // Get user info
        const author = msg.author || msg.from;
        let userId = null;

        try {
          const contact = await msg.getContact();
          if (contact && contact.id && contact.id._serialized) {
            userId = contact.id._serialized;
          }
        } catch (err) {
          userId = author;
        }

        // Resolve userId to UUID
        const userRes = await backendClient.sendToBackend(
          `/api/users/by-identifier/${encodeURIComponent(userId)}`,
          null,
          "GET"
        );

        if (!userRes || !userRes.user) {
          return reply("❌ Você precisa estar cadastrado para criar playlist.");
        }

        const userUuid = userRes.user.id;

        logger.info(
          `[Playlist] Criando playlist "${playlistName}" para grupo ${chatId}`
        );

        const createRes = await backendClient.sendToBackend(
          `/api/groups/${encodeURIComponent(chatId)}/playlist/create`,
          {
            userId: userUuid,
            name: playlistName,
            description: `Playlist colaborativa do grupo WhatsApp`,
          }
        );

        if (createRes && createRes.success) {
          return reply(
            `✅ Playlist criada e vinculada ao grupo!\n\n` +
              `🎵 ${createRes.playlist.name}\n` +
              `${createRes.playlist.description || ""}\n\n` +
              `Agora o grupo pode votar para adicionar músicas usando /voto\n\n` +
              `🔗 ${createRes.spotifyUrl || ""}`
          );
        } else {
          return reply(
            `❌ Erro ao criar playlist: ${
              createRes?.error || "Erro desconhecido"
            }`
          );
        }
      }

      return reply(
        "⚠️ Comando inválido.\n\n" +
          "Uso:\n" +
          "/playlist - Ver playlist atual\n" +
          "/playlist create <nome> - Criar nova playlist\n" +
          "/playlist set <id_spotify> - Vincular playlist existente\n\n" +
          "Exemplo:\n" +
          "/playlist create Música do Grupo\n" +
          "/playlist set 37i9dQZF1DXcBWIGoYBM5M"
      );
    } catch (err) {
      logger.error("[Playlist] Erro:", err);
      return reply("❌ Erro ao acessar playlist. Tente novamente mais tarde.");
    }
  },
};
