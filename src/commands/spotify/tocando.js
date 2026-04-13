const fetch = require("node-fetch");
const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const {
  jidFromContact,
  lookupByIdentifier,
} = require("../../utils/whatsapp/getUserData");
const { sendTrackSticker } = require("../../utils/media/stickerHelper");
const { MessageMedia } = require("whatsapp-web.js");
const { isFromApp } = require("./fromAppText");

const BACKEND_BASE = (
  process.env.BACKEND_URL || "http://localhost:8000"
).replace(/\/$/, "");

function msToTime(ms) {
  if (!ms && ms !== 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function renderProgressBar(percent, width = 16) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;
  return "[" + "█".repeat(filled) + "-".repeat(empty) + "]";
}

module.exports = {
  name: "tocando",
  aliases: ["np", "nowplaying"],
  description: "Ver música tocando no Spotify agora",

  async execute(context) {
    const { message, reply, client } = context;
    const msg = message;
    const fromBubble = isFromApp(msg);
    const isGroup =
      !!(msg && msg.isGroup) ||
      (msg.from && String(msg.from).endsWith("@g.us"));

    let userId = msg.author || msg.from;
    if (msg && typeof msg.getContact === "function") {
      try {
        const contact = await msg.getContact();
        const jid = jidFromContact(contact);
        if (jid) userId = jid;
      } catch (err) {
        logger.warn("[Command:tocando] Erro ao obter contacto:", err.message);
      }
    }

    const mentionJid =
      userId &&
      typeof userId === "string" &&
      !userId.endsWith("@g.us") &&
      userId.includes("@")
        ? userId
        : null;

    try {
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          String(userId || ""),
        );
      let userParam = userId;
      if (!isUUID) {
        const lu = await lookupByIdentifier(userId);
        if (lu && lu.found && lu.userId) userParam = lu.userId;
      }
      let json;
      try {
        json = await backendClient.sendToBackend(
          `/api/spotify/current?userId=${encodeURIComponent(userParam)}`,
          null,
          "GET",
        );
      } catch (e) {
        logger.warn("[Command:tocando] Erro do backend current:", e);
        await reply(
          "❌ Erro ao consultar o servidor. Tenta novamente em instantes.",
        );
        return;
      }

      if (json && json.notice) {
        await reply(json.notice);
        return;
      }
      if (!json || !json.playing) {
        await reply("⏸️ Nenhuma faixa em reprodução no momento.");
      } else {
        const t = json.track || {};
        const durationMs = t.durationMs || 0;
        const positionMs =
          json.listenedMs ||
          Math.round(((json.percentPlayed || 0) / 100) * durationMs);
        const percent = Math.round(
          json.percentPlayed ||
            (durationMs ? (positionMs / durationMs) * 100 : 0),
        );
        const bar = renderProgressBar(percent, 18);

        const headLine =
          fromBubble && isGroup && mentionJid
            ? `▶️ @${mentionJid.split("@")[0]} está tocando agora — ${t.name}\n`
            : `▶️ Tocando agora — ${t.name}\n`;

        let replyText = headLine;
        replyText += `${
          Array.isArray(t.artists) ? t.artists.join(", ") : t.artists || ""
        }\n`;
        if (t.album) replyText += `Álbum: ${t.album}\n`;
        replyText += `\n${bar} ${percent}%\n${msToTime(
          positionMs,
        )} / ${msToTime(durationMs)}\n`;
        // Format startedAt as DD/MM/YYYY HH:MM:SS in UTC-3 (24h)
        try {
          const started = new Date(json.startedAt);
          // convert to UTC-3 by subtracting 3 hours
          const startedUtcMinus3 = new Date(
            started.getTime() - 3 * 60 * 60 * 1000,
          );
          const pad = (n) => String(n).padStart(2, "0");
          const startedStr = `${pad(startedUtcMinus3.getUTCDate())}/${pad(
            startedUtcMinus3.getUTCMonth() + 1,
          )}/${startedUtcMinus3.getUTCFullYear()}, ${pad(
            startedUtcMinus3.getUTCHours(),
          )}:${pad(startedUtcMinus3.getUTCMinutes())}:${pad(
            startedUtcMinus3.getUTCSeconds(),
          )}`;

          replyText += `Iniciado: ${startedStr}`;
        } catch (e) {
          // fallback to original representation if parsing fails
          replyText += `Iniciado: ${new Date(json.startedAt).toLocaleString()}`;
        }

        if (fromBubble) {
          replyText += `\n\nSolicitado pelo *DogBubble*`;
        }

        if (fromBubble && isGroup && mentionJid) {
          await client.sendMessage(msg.from, replyText, {
            mentions: [mentionJid],
          });
        } else {
          await reply(replyText);
        }

        // Send track artwork as sticker first
        const trackWithImage = {
          trackId: t.id,
          trackName: t.name,
          image: t.imageUrl,
        };
        await sendTrackSticker(client, msg.from, trackWithImage);

        // Then use backend proxy to fetch cached preview (avoids CORS and centralizes rate-limits)
        try {
          const proxyUrl = `${BACKEND_BASE}/api/spotify/preview?trackId=${encodeURIComponent(t.id)}`;
          const pres = await fetch(proxyUrl);

          const contentType =
            (pres.headers && pres.headers.get
              ? pres.headers.get("content-type")
              : null) || "";
          if (pres && pres.ok && contentType.includes("audio")) {
            const arrayBuffer = await pres.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const base64 = buffer.toString("base64");
            const media = new MessageMedia("audio/mpeg", base64);
            await client.sendMessage(msg.from, media, {
              caption: `▶️ Prévia — ${t.name}`,
            });
          }
        } catch (_e) {
          // prévia opcional; falhas ignoradas
        }
      }
    } catch (err) {
      logger.warn("[Command:tocando] Erro:", err);
      await reply(
        "❌ Erro ao consultar tocando agora: " + (err.message || err),
      );
    }
  },
};
