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
      for (const jam of jams) {
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

        out += `━━━━━━━━━━━━━━━━━━\n`;
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
        const tracksForSticker = jams
          .filter((jam) => jam.currentTrackName) // Only jams with tracks playing
          .map((jam) => ({
            trackId: jam.currentTrackId,
            trackName: jam.currentTrackName,
            artists: jam.currentArtists,
            image:
              jam.currentTrackImage ||
              jam.currentAlbumImage ||
              "https://via.placeholder.com/512", // fallback
          }))
          .slice(0, 9); // Max 9 tracks for composite

        if (tracksForSticker.length > 0 && ctx.client) {
          const ok = await sendCompositeSticker(
            ctx.client,
            chatId || ctx.message?.from,
            tracksForSticker,
          );
          if (!ok) {
            logger.info("[Jams] sendCompositeSticker failed");
          }
        }
      } catch (err) {
        logger.error("[Jams] Error sending composite sticker: " + err.message);
      }
    } catch (err) {
      console.error("[jams] Error:", err);
      await reply(`❌ Erro ao listar jams: ${err.message}`);
    }
  },
};
