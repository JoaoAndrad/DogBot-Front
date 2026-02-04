const backend = require("../../services/backendClient");
const { sendCompositeSticker } = require("../../utils/stickerHelper");
const logger = require("../../utils/logger");

/**
 * Resolve host name with WhatsApp fallback
 * @param {Object} jam - Jam object with host data
 * @param {Object} client - WhatsApp client instance
 * @returns {Promise<string>} Resolved host name
 */
async function resolveHostName(jam, client) {
  // Try database fields first
  let name = jam.host?.push_name || jam.host?.display_name;

  // If empty, try to fetch from WhatsApp
  if (!name && jam.host?.sender_number && client) {
    try {
      const whatsappId = jam.host.sender_number.includes("@")
        ? jam.host.sender_number
        : `${jam.host.sender_number}@c.us`;

      const contact = await client.getContactById(whatsappId);
      name = contact?.pushname || contact?.name;
    } catch (err) {
      // Silently fail and use fallback
    }
  }

  // Final fallbacks: phone number or "Anônimo"
  return name || jam.host?.sender_number || "Anônimo";
}

module.exports = {
  name: "jams",
  aliases: ["jam.list", "jam.info"],
  description:
    "Mostra informações sobre jams ativas (música, álbum, artista e ouvintes)",
  async execute(ctx) {
    const reply =
      typeof ctx.reply === "function" ? ctx.reply : (t) => console.log(t);

    try {
      const chatId = ctx.message?.from || null;
      const isGroup = chatId && chatId.includes("@g.us");

      let jams = [];

      if (isGroup && ctx.message && typeof ctx.message.getChat === "function") {
        // For groups: check every participant and collect any jam they host or listen to
        try {
          const chat = await ctx.message.getChat();
          const participants = chat.participants || [];
          const ids = participants
            .map((p) => (p.id && p.id._serialized) || p.id || null)
            .filter(Boolean);

          const jamMap = new Map();

          // Resolve each participant to a user UUID and query their jam status
          for (const pid of ids) {
            try {
              const lookup = await backend.sendToBackend(
                `/api/users/lookup?identifier=${encodeURIComponent(pid)}`,
                null,
                "GET",
              );
              if (!lookup || !lookup.found || !lookup.userId) continue;
              const userUuid = lookup.userId;
              const status = await backend.sendToBackend(
                `/api/jam/user/${userUuid}/status`,
                null,
                "GET",
              );
              if (!status || !status.success) continue;
              if (status.role === "host" || status.role === "listener") {
                const jam = status.jam;
                if (jam && jam.id && !jamMap.has(jam.id)) {
                  jamMap.set(jam.id, jam);
                }
              }
            } catch (e) {
              // ignore per-participant errors
            }
          }

          jams = Array.from(jamMap.values());
        } catch (e) {
          console.error("[jams] Error fetching group participants:", e);
          // fallback to global active list
        }
      }

      // If not group or fallback: fetch global active jams
      if (!isGroup || !jams || jams.length === 0) {
        const res = await backend.sendToBackend(`/api/jam/active`, null, "GET");
        if (!res || !res.success) {
          await reply(
            "❌ Erro ao buscar jams ativas. Tente novamente mais tarde.",
          );
          return;
        }
        jams = res.jams || [];
      }

      if (!jams || jams.length === 0) {
        await reply("🎵 Nenhuma jam ativa no momento.");
        return;
      }

      // Build output listing each jam
      let out = "🎧 Jams ativas:\n\n";
      for (let i = 0; i < jams.length; i++) {
        const jam = jams[i];
        const hostName = await resolveHostName(jam, ctx.client);

        // Count listeners (excluding host)
        const activeListeners = jam.listeners?.filter((l) => l.isActive) || [];
        const listenerCount = activeListeners.length;

        const track = jam.currentTrackName || null;
        const artists = jam.currentArtists || null;
        // Album is not always available on jam model; attempt to use jam.currentAlbum if present
        const album = jam.currentAlbum || jam.currentTrackAlbum || null;

        // List listener names (excluding host)
        const names = [];
        for (const l of activeListeners) {
          try {
            const n = l.user?.display_name || l.user?.push_name || null;
            if (n && n !== hostName) names.push(n);
          } catch (e) {
            // ignore
          }
        }

        // Only add separator between jams, not before the first one
        if (i > 0) {
          out += `━━━━━━━━━━━━━━━━━━\n`;
        }
        if (listenerCount === 0) {
          out += `🎙️ *${hostName}* (Sem ouvintes)\n`;
        } else {
          out += `🎙️ *${hostName}* (${listenerCount} ${listenerCount === 1 ? "ouvinte" : "ouvintes"})\n`;
        }
        out += `\n`;

        if (track) {
          out += `🎶 *${track}*\n`;
          if (artists) out += `👤 ${artists}\n`;
          if (album) out += `💿 ${album}\n`;
          if (names.length > 0) {
            out += `👥 ${names.join(", ")}\n`;
          }
        } else {
          out += `⏸️ _Nada tocando no momento_\n`;
        }

        out += `\n`;
      }

      await reply(out);

      // Send composite sticker with album art from playing jams
      try {
        // Build tracks for sticker, fetching missing images from Spotify
        const tracksForSticker = [];

        for (const jam of jams) {
          if (!jam.currentTrackName) continue; // Skip jams not playing anything

          let image = jam.currentTrackImage || jam.currentAlbumImage;

          // If no image in jam data, fetch from Spotify API
          if (!image && jam.currentTrackId) {
            try {
              logger.info(
                `[Jams] Fetching album art for track ${jam.currentTrackId}`,
              );
              const trackRes = await backend.sendToBackend(
                `/api/spotify/track/${encodeURIComponent(jam.currentTrackId)}`,
                null,
                "GET",
              );

              if (trackRes && trackRes.track) {
                // Try to get image from album
                if (
                  trackRes.track.album &&
                  trackRes.track.album.images &&
                  trackRes.track.album.images.length > 0
                ) {
                  // Get largest image (first one is usually largest)
                  image = trackRes.track.album.images[0].url;
                  logger.info(
                    `[Jams] Found album art from Spotify API: ${image}`,
                  );
                }
              }
            } catch (fetchErr) {
              logger.warn(
                `[Jams] Failed to fetch album art for ${jam.currentTrackId}: ${fetchErr.message}`,
              );
            }
          }

          if (image) {
            tracksForSticker.push({
              trackId: jam.currentTrackId,
              trackName: jam.currentTrackName,
              artists: jam.currentArtists,
              image,
            });
          }

          if (tracksForSticker.length >= 9) break; // Max 9 tracks for composite
        }

        logger.info(
          `[Jams] Found ${tracksForSticker.length} tracks with images for sticker`,
        );

        if (tracksForSticker.length > 0) {
          if (!ctx.client) {
            logger.error("[Jams] No client available for sending sticker");
          } else {
            logger.info(
              `[Jams] Attempting to send composite sticker to ${chatId}`,
            );
            const ok = await sendCompositeSticker(
              ctx.client,
              chatId || ctx.message?.from,
              tracksForSticker,
            );
            if (!ok) {
              logger.warn(
                "[Jams] sendCompositeSticker returned false - sticker may not have been sent",
              );
            } else {
              logger.info("[Jams] Composite sticker sent successfully");
            }
          }
        } else {
          logger.info(
            "[Jams] No tracks with valid images found, skipping sticker",
          );
        }
      } catch (err) {
        logger.error("[Jams] Error sending composite sticker: " + err.message);
        logger.error("[Jams] Stack trace: " + err.stack);
      }
    } catch (err) {
      console.error("[jams] Error:", err);
      await reply(`❌ Erro ao listar jams: ${err.message}`);
    }
  },
};
