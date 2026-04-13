const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const { formatLife360PlaceLine } = require("../../utils/formatters/life360PlaceFormat");
const {
  sendTrackSticker,
  sendCompositeSticker,
} = require("../../utils/media/stickerHelper");
const { isFromApp } = require("./fromAppText");

module.exports = {
  name: "todos",
  aliases: ["tocando-todos", "todes"],
  description: "Mostra o que todo mundo do grupo está ouvindo (Spotify)",

  async execute(ctx) {
    const { message, reply, client } = ctx;
    const msg = message;
    const fromBubble = isFromApp(msg);
    const chatId = msg.from;

    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));
    if (!isGroup) return reply("⚠️ Este comando só funciona em grupos.");

    // Mesmo esquema que note.js: JID real do remetente (getContact em WA; gateway define msg.author).
    let author = (msg && (msg.author || msg.from)) || null;
    if (msg && typeof msg.getContact === "function") {
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          author = contact.id._serialized;
        }
      } catch (err) {
        logger.info("[Todos] getContact: " + (err.message || err));
      }
    }

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

      const locByUserId = new Map();
      try {
        const locRes = await backendClient.sendToBackend(
          `/api/groups/${encodeURIComponent(chatId)}/life360-locations`,
          { memberIds },
          "POST",
        );
        for (const entry of locRes?.locations || []) {
          if (entry?.userId != null) locByUserId.set(entry.userId, entry);
        }
      } catch (locErr) {
        logger.info("[Todos] life360-locations: " + (locErr.message || locErr));
      }

      function placeForUser(userId) {
        const entry = locByUserId.get(userId);
        return formatLife360PlaceLine(entry?.location);
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
        byTrack.get(key).push({ who, track: t, userId: l.userId });
      }

      const mentionJid =
        author &&
        typeof author === "string" &&
        !author.endsWith("@g.us") &&
        author.includes("@")
          ? author
          : null;

      const lines = [];
      if (fromBubble) {
        if (mentionJid) {
          const base = mentionJid.split("@")[0];
          lines.push(
            `@${base} perguntou o que a galera está ouvindo através do *DogBubble*:\n`,
          );
        } else {
          lines.push(
            "Usuário perguntou o que a galera está ouvindo através do *DogBubble*:\n",
          );
        }
      } else {
        lines.push("🎵 O que a galera está ouvindo:\n");
      }

      // Helper to compute percent if available
      function pct(track) {
        const p = track.progress_ms || track.progressMs || track.progress || 0;
        const d = track.duration_ms || track.durationMs || track.duration || 0;
        if (!p || !d) return null;
        return Math.round((p / d) * 100);
      }

      // Build message per track group
      for (const [, group] of byTrack.entries()) {
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
          if (percent !== null) lines.push(`   ⏱️ ${percent}%`);
          const pl = placeForUser(item.userId);
          if (pl) lines.push(`   📍 ${pl}`);
          lines.push("");
        } else {
          const t = group[0].track;
          const artists = Array.isArray(t.artists)
            ? t.artists.join(", ")
            : t.artists || "";
          lines.push(`🎵 JAM — ${t.trackName} - ${artists}`);
          for (const g of group) {
            const p = pct(g.track);
            let head = `🎶 ${g.who}`;
            if (p !== null) head += ` · ⏱️ ${p}%`;
            lines.push(head);
            const pl = placeForUser(g.userId);
            if (pl) lines.push(`   📍 ${pl}`);
          }
          lines.push("");
        }
      }

      if (notPlaying.length > 0) {
        lines.push(`⏸️ Sem música: ${notPlaying.join(", ")}`);
      }

      const finalMsg = lines.join("\n");

      const sendOpts =
        fromBubble && mentionJid ? { mentions: [mentionJid] } : {};

      // Send the text summary first (menção ao remetente no *DogBubble*, como skip/voto).
      await client.sendMessage(chatId, finalMsg, sendOpts);

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
