const backendClient = require("../../services/backendClient");
const { sendTrackSticker } = require("../../utils/stickerHelper");

module.exports = {
  name: "nota",
  description:
    "Ver ou registrar nota da música que você está ouvindo. Ex: /nota ou /nota 8.5",
  async execute(ctx) {
    const body = String(
      (ctx.info && ctx.info.body) || (ctx.message && ctx.message.body) || ""
    ).trim();
    const msg = ctx.message;
    let author =
      (msg && (msg.author || msg.from)) || (ctx.info && ctx.info.from);
    const reply = ctx.reply;

    // Usar getContact() para obter o número real (@c.us)
    if (msg) {
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          author = contact.id._serialized;
        }
      } catch (err) {
        console.log("[Command:nota] Error getting contact:", err.message);
      }
    }

    // /nota sem valor = só consultar; /nota 8.5 = registrar
    const parts = body.split(/\s+/);
    const ratingRaw = parts.length >= 2 ? parts[1] : null;

    const payload = {
      userId: author,
      source: "whatsapp",
    };
    if (ratingRaw != null && ratingRaw !== "") payload.rating = ratingRaw;

    try {
      const res = await backendClient.sendToBackend("/api/spotify/notes", payload);

      if (res && res.success) {
        const trackName = res.trackName || "Música";
        const artist = res.artist || "Desconhecido";
        const album = res.album || null;
        const imageUrl = res.imageUrl || null;
        const hasUserRating = res.hasUserRating === true;
        const rating = res.rating != null ? Number(res.rating).toFixed(1) : null;
        const avg = res.avgRating != null ? Number(res.avgRating).toFixed(1) : null;
        const count = res.ratingCount || 0;
        const countLabel = Number(count) === 1 ? "avaliação" : "avaliações";

        const trackWithImage = {
          trackId: res.trackId,
          trackName: trackName,
          image: imageUrl,
        };

        // Sempre o mesmo formato: faixa + sua nota + média (sem "Nota registrada/atualizada")
        let lineNota;
        if (hasUserRating && rating != null) {
          lineNota = `⭐ Sua nota: ${rating} / 10`;
        } else {
          lineNota = "⭐ Você ainda não avaliou esta música.";
        }

        let lineMedia;
        if (count > 0 && avg != null) {
          lineMedia = `📈 Média: ${avg} — ${count} ${countLabel}`;
        } else {
          lineMedia = "📈 Nenhuma avaliação ainda.";
        }

        const confirmationText = `🎶 ${trackName}\n👤 Artista: ${artist}\n💿 Álbum: ${
          album || "Desconhecido"
        }\n\n${lineNota}\n${lineMedia}`;

        try {
          await reply(confirmationText);
        } catch (e) {
          console.error(
            "Erro ao enviar confirmação de nota:",
            e && e.message ? e.message : e
          );
        }

        try {
          await sendTrackSticker(ctx.client, msg.from, trackWithImage);
        } catch (stErr) {
          console.error(
            "Erro ao enviar figurinha da faixa:",
            stErr && stErr.message ? stErr.message : stErr
          );
        }

        return;
      }

      if (res && res.error) {
        // If backend provided a human message, show it verbatim
        if (res.message) return reply(res.message);

        if (res.error === "not_playing" || res.error === "no_track_playing") {
          return reply(
            res.message || "Nenhuma música tocando no momento."
          );
        }
        if (res.error === "invalid_rating") {
          return reply(
            "Valor inválido. Use número entre 0.0 e 10.0 (ex: 8.5 ou 8,5)"
          );
        }
        return reply(`Erro: ${res.error}`);
      }

      return reply("Falha ao registrar nota. Tente novamente.");
    } catch (err) {
      console.error("nota command error", err && err.message);
      return reply("Erro ao registrar nota. Tente novamente.");
    }
  },
};
