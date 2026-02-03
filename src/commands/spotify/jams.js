const backend = require("../../services/backendClient");

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
        const hostName =
          jam.host?.push_name || jam.host?.display_name || "Anônimo";

        // Count listeners and include host as listener per request
        const activeListeners = jam.listeners?.filter((l) => l.isActive) || [];
        const listenerCount = (activeListeners.length || 0) + 1; // include host

        const track = jam.currentTrackName || null;
        const artists = jam.currentArtists || null;
        // Album is not always available on jam model; attempt to use jam.currentAlbum if present
        const album = jam.currentAlbum || jam.currentTrackAlbum || null;

        out += `🎙️ *${hostName}*\n`;
        out += `👥 Ouvintes: ${listenerCount}\n`;

        if (track) {
          out += `🎶 Música: ${track}\n`;
          if (album) out += `💿 Álbum: ${album}\n`;
          if (artists) out += `👤 Artista(s): ${artists}\n`;
        } else {
          out += `⏸️ Nada tocando no momento\n`;
        }

        // List listener names (host first)
        const names = [hostName];
        for (const l of activeListeners) {
          try {
            const n = l.user?.push_name || l.user?.display_name || null;
            if (n && n !== hostName) names.push(n);
          } catch (e) {
            // ignore
          }
        }

        out += `\n👥 Usuários ouvindo: ${names.join(", ")}\n`;
      }

      await reply(out);
    } catch (err) {
      console.error("[jams] Error:", err);
      await reply(`❌ Erro ao listar jams: ${err.message}`);
    }
  },
};
