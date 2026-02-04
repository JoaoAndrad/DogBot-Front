const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const {
  sendTrackSticker,
  sendCompositeSticker,
} = require("../../utils/stickerHelper");

module.exports = {
  name: "todos",
  aliases: ["tocando-todos", "todes"],
  description: "Mostra o que todo mundo do grupo está ouvindo (Spotify)",

  async execute(ctx) {
    const { message, reply, client } = ctx;
    const msg = message;
    const chatId = msg.from;

    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));
    if (!isGroup) return reply("⚠️ Este comando só funciona em grupos.");

    try {
      // Get group members
      const chat = await msg.getChat();
      const memberIds = chat.participants.map((p) => p.id._serialized);

      // Fetch active listeners from backend
      const listenersRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}/active-listeners`,
        { memberIds },
        "POST",
      );

      if (!listenersRes || !Array.isArray(listenersRes.listeners)) {
        return reply("⚠️ Erro ao consultar ouvintes. Tente novamente.");
      }

      const listeners = listenersRes.listeners;

      // If no listeners connected or none playing, inform the group
      const anyPlaying = (listeners || []).some(
        (l) => l && l.currentTrack && l.currentTrack.isPlaying,
      );
      if (!anyPlaying) {
        return reply("Nenhum usuário do grupo está ouvindo músicas no momento");
      }

      // Prepare groups: jam groups (same trackId + contextId) and individuals
      const byTrack = new Map();
      const notPlaying = [];

      for (const l of listeners) {
        const who = l.displayName || l.identifier || l.userId || "Usuário";
        const t = l.currentTrack;
        if (!t || !t.trackId || !t.trackName || !t.isPlaying) {
          notPlaying.push(who);
          continue;
        }

        const key = `${t.trackId}::${t.contextId || "noctx"}`;
        if (!byTrack.has(key)) byTrack.set(key, []);
        byTrack.get(key).push({ who, track: t });
      }

      const lines = [];
      lines.push("🎵 O que a galera está ouvindo:\n");

      // Helper to compute percent if available
      function pct(track) {
        const p = track.progress_ms || track.progressMs || track.progress || 0;
        const d = track.duration_ms || track.durationMs || track.duration || 0;
        if (!p || !d) return null;
        return Math.round((p / d) * 100);
      }

      // Build message per track group
      for (const [key, group] of byTrack.entries()) {
        if (group.length === 1) {
          const item = group[0];
          const t = item.track;
          const percent = pct(t);
          lines.push(`🎶 ${item.who}:`);
          lines.push(
            `   ${t.trackName} - ${
              Array.isArray(t.artists) ? t.artists.join(", ") : t.artists || ""
            }`,
          );
          lines.push(`   ${percent !== null ? `⏱️ ${percent}%` : ""}`);
          lines.push("");
        } else {
          // multiple listeners: if their percent close, mark as JAM coletiva
          const percents = group.map((g) => ({
            who: g.who,
            pct: pct(g.track),
          }));
          const validPercs = percents
            .filter((p) => p.pct !== null)
            .map((p) => p.pct);
          let approx = "";
          if (validPercs.length > 0) {
            // compute average and show ~avg%
            const avg = Math.round(
              validPercs.reduce((a, b) => a + b, 0) / validPercs.length,
            );
            approx = `\n   ⏱️ ~${avg}%`;
          }

          const names = group
            .map((g) => g.who)
            .slice(0, 3)
            .join(" e ");
          const t = group[0].track;
          lines.push(`🎵 JAM Coletiva (${names}):`);
          lines.push(
            `   ${t.trackName} - ${
              Array.isArray(t.artists) ? t.artists.join(", ") : t.artists || ""
            }${approx}`,
          );
          lines.push("");
        }
      }

      if (notPlaying.length > 0) {
        lines.push(`⏸️ Sem música: ${notPlaying.join(", ")}`);
      }

      const finalMsg = lines.join("\n");

      // Send the text summary first.
      await client.sendMessage(chatId, finalMsg);

      // Then try to send a composite sticker representing the distinct tracks.
      try {
        const tracksArr = Array.from(byTrack.values())
          .map((g) => g[0].track)
          .filter(Boolean)
          .slice(0, 9);
        if (tracksArr.length > 0) {
          const ok = await sendCompositeSticker(client, chatId, tracksArr);
          if (!ok)
            logger.info("[Todos] sendCompositeSticker failed after text");
        }
      } catch (e) {
        logger.error(
          "[Todos] error sending composite sticker after text: " + e.message,
        );
      }

      return;
    } catch (err) {
      logger.error("[Todos] erro:", err);
      return reply(
        "❌ Erro ao gerar a lista de ouvintes. Tente novamente mais tarde.",
      );
    }
  },
};
