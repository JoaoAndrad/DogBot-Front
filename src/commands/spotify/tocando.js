const fetch = require("node-fetch");
const { sendTrackSticker } = require("../../utils/stickerHelper");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

async function resolveUserUuid(externalId) {
  if (!externalId) return null;
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      externalId
    );
  if (isUUID) return externalId;

  try {
    const url = `${BACKEND_URL}/api/users/by-identifier/${encodeURIComponent(
      externalId
    )}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const json = await res.json();
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
    const { message, reply } = context;
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
      const url = `${BACKEND_URL}/api/spotify/current?userId=${encodeURIComponent(
        userParam
      )}`;
      const res = await fetch(url, { method: "GET" });
      const ct =
        (res.headers && res.headers.get
          ? res.headers.get("content-type")
          : null) || "";
      let json;
      if (!ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        console.log(
          "[Command:tocando] Non-JSON response from backend:",
          text.slice(0, 1000)
        );
        await reply(
          "❌ Resposta inválida do servidor ao consultar tocando agora."
        );
        return;
      }
      json = await res.json();

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
        replyText += `Iniciado: ${new Date(json.startedAt).toLocaleString()}`;

        await reply(replyText);

        // Send track artwork as sticker
        const trackWithImage = {
          trackId: t.id,
          trackName: t.name,
          image: t.imageUrl,
        };
        await sendTrackSticker(context.client, msg.from, trackWithImage);
      }
    } catch (err) {
      console.log("[Command:tocando] Error:", err);
      await reply(
        "❌ Erro ao consultar tocando agora: " + (err.message || err)
      );
    }
  },
};
