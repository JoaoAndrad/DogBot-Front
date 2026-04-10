const fetch = require("node-fetch");
const backendClient = require("../../services/backendClient");
const { sendTrackSticker } = require("../../utils/stickerHelper");
const { MessageMedia } = require("whatsapp-web.js");

const BACKEND_BASE = (
  process.env.BACKEND_URL || "http://localhost:8000"
).replace(/\/$/, "");

async function resolveUserUuid(externalId) {
  if (!externalId) return null;
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      externalId
    );
  if (isUUID) return externalId;

  try {
    const json = await backendClient.sendToBackend(
      `/api/users/by-identifier/${encodeURIComponent(externalId)}`,
      null,
      "GET",
    );
    return json && json.user && json.user.id ? json.user.id : null;
  } catch (e) {
    return null;
  }
}

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

    // Usar getContact() para obter o número real (@c.us)
    let userId = msg.author || msg.from;
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        userId = contact.id._serialized;
      }
    } catch (err) {
      console.log("[Command:tocando] Error getting contact:", err.message);
    }

    try {
      const resolved = await resolveUserUuid(userId);
      const userParam = resolved || userId;
      let json;
      try {
        json = await backendClient.sendToBackend(
          `/api/spotify/current?userId=${encodeURIComponent(userParam)}`,
          null,
          "GET",
        );
      } catch (e) {
        console.log("[Command:tocando] Error from backend current:", e);
        await reply(
          "❌ Erro ao consultar o servidor. Tenta novamente em instantes."
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
            (durationMs ? (positionMs / durationMs) * 100 : 0)
        );
        const bar = renderProgressBar(percent, 18);

        let replyText = `▶️ Tocando agora — ${t.name}\n`;
        replyText += `${
          Array.isArray(t.artists) ? t.artists.join(", ") : t.artists || ""
        }\n`;
        if (t.album) replyText += `Álbum: ${t.album}\n`;
        replyText += `\n${bar} ${percent}%\n${msToTime(
          positionMs
        )} / ${msToTime(durationMs)}\n`;
        // Format startedAt as DD/MM/YYYY HH:MM:SS in UTC-3 (24h)
        try {
          const started = new Date(json.startedAt);
          // convert to UTC-3 by subtracting 3 hours
          const startedUtcMinus3 = new Date(
            started.getTime() - 3 * 60 * 60 * 1000
          );
          const pad = (n) => String(n).padStart(2, "0");
          const startedStr = `${pad(startedUtcMinus3.getUTCDate())}/${pad(
            startedUtcMinus3.getUTCMonth() + 1
          )}/${startedUtcMinus3.getUTCFullYear()}, ${pad(
            startedUtcMinus3.getUTCHours()
          )}:${pad(startedUtcMinus3.getUTCMinutes())}:${pad(
            startedUtcMinus3.getUTCSeconds()
          )}`;

          replyText += `Iniciado: ${startedStr}`;
        } catch (e) {
          // fallback to original representation if parsing fails
          replyText += `Iniciado: ${new Date(json.startedAt).toLocaleString()}`;
        }

        await reply(replyText);

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
          console.log(`[tocando] proxy preview url: ${proxyUrl}`);
          const pres = await fetch(proxyUrl);
          console.log(
            `[tocando] proxy preview fetch status: ${pres && pres.status}`
          );

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
          } else {
            // When preview not available, backend returns JSON with error info
            try {
              const body = await pres.json().catch(() => null);
              console.log(
                "[tocando] proxy preview response not audio, body:",
                body
              );
            } catch (e) {
              console.log(
                "[tocando] proxy preview: non-audio response and failed to parse body"
              );
            }
          }
        } catch (e) {
          console.log(
            "[tocando] failed to fetch/send preview via proxy:",
            e && e.stack ? e.stack : e
          );
        }
      }
    } catch (err) {
      console.log("[Command:tocando] Error:", err);
      await reply(
        "❌ Erro ao consultar tocando agora: " + (err.message || err)
      );
    }
  },
};
