const backendClient = require("../../services/backendClient");
const { sendTrackSticker } = require("../../utils/stickerHelper");

module.exports = {
  name: "nota",
  description:
    "Registrar nota para a música que você está ouvindo. Ex: /nota 8.5",
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

    // Extract rating value from command
    const parts = body.split(/\s+/);
    if (parts.length < 2) {
      return reply("Uso: /nota <valor> (ex: /nota 8.5)");
    }

    const ratingRaw = parts[1];

    // Send to backend - let backend handle validation, track resolution, and saving
    try {
      const res = await backendClient.sendToBackend("/api/spotify/notes", {
        userId: author,
        rating: ratingRaw,
        source: "whatsapp",
      });

      if (res && res.success) {
        const trackName = res.trackName || "Música";
        const artist = res.artist || "Desconhecido";
        const album = res.album || null;
        const imageUrl = res.imageUrl || null;
        const rating = res.rating ? Number(res.rating).toFixed(1) : "N/A";
        const avg = res.avgRating ? Number(res.avgRating).toFixed(1) : "N/A";
        const count = res.ratingCount || 0;
        const countLabel = Number(count) === 1 ? "avaliação" : "avaliações";
        const prev =
          res.previousRating != null ? String(res.previousRating) : null;
        const prevDate = res.previousRatingDate || null;

        // Prepare track sticker payload
        const trackWithImage = {
          trackId: res.trackId,
          trackName: trackName,
          image: imageUrl,
        };

        // Build confirmation text first
        let confirmationText;
        if (prev) {
          // updated
          const prevDateStr = prevDate
            ? new Intl.DateTimeFormat("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              }).format(new Date(prevDate))
            : null;

          confirmationText = `✅ Nota atualizada!\n🎶 ${trackName}\n👤 Artista: ${artist}\n💿 Álbum: ${
            album || "Desconhecido"
          }\n\n🔁 Sua nota anterior: ${prev}${
            prevDateStr ? " — em " + prevDateStr : ""
          }\n⭐ Nova nota: ${rating} / 10\n📈 Média: ${avg} — ${count} ${countLabel}`;
        } else {
          // first time
          confirmationText = `✅ Nota registrada!\n🎶 ${trackName}\n👤 Artista: ${artist}\n💿 Álbum: ${
            album || "Desconhecido"
          }\n\n⭐ Sua nota: ${rating} / 10\n📈 Média: ${avg} — ${count} ${countLabel}`;
        }

        // Reply first, then send sticker (sticker errors shouldn't block the reply)
        try {
          await reply(confirmationText);
        } catch (e) {
          // if reply itself fails, still attempt sticker but log
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

        // We've already replied above
        return;
      }

      if (res && res.error) {
        // If backend provided a human message, show it verbatim
        if (res.message) return reply(res.message);

        if (res.error === "no_track_playing") {
          return reply(
            "Não consegui detectar qual música você está ouvindo no momento."
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
