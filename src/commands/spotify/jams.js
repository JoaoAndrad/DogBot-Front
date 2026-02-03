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

      // Fetch active jams; optionally filter by chat if group
      const res = await backend.sendToBackend(
        `/api/jam/active${isGroup ? `?chatId=${chatId}` : ""}`,
        null,
        "GET",
      );

      if (!res || !res.success) {
        await reply(
          "❌ Erro ao buscar jams ativas. Tente novamente mais tarde.",
        );
        return;
      }

      const jams = res.jams || [];
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

        const track = jam.currentTrackName || "—";
        const artists = jam.currentArtists || "—";
        // Album is not always available on jam model; attempt to use jam.currentAlbum if present
        const album = jam.currentAlbum || jam.currentTrackAlbum || "—";

        out += `🎙️ *${hostName}*\n`;
        out += `👥 Ouvintes: ${listenerCount}\n`;
        out += `🎶 Música: ${track}\n`;
        out += `💿 Álbum: ${album}\n`;
        out += `👤 Artista(s): ${artists}\n`;

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

        out += `👥 Usuários ouvindo: ${names.join(", ")}\n`;
        out += `\n`;
      }

      await reply(out);
    } catch (err) {
      console.error("[jams] Error:", err);
      await reply(`❌ Erro ao listar jams: ${err.message}`);
    }
  },
};
