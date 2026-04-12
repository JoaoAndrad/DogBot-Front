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
    const fromApp = Boolean(msg && msg.fromApp);

    // Mensagens reais do wa têm getContact(); simuladas (gateway) não.
    if (msg && typeof msg.getContact === "function") {
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
      source: fromApp ? "companion_app" : "whatsapp",
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
        const noteCreated = res.noteCreated === true;
        const rating = res.rating != null ? Number(res.rating).toFixed(1) : null;
        const avg = res.avgRating != null ? Number(res.avgRating).toFixed(1) : null;
        const count = res.ratingCount || 0;
        const countLabel = Number(count) === 1 ? "avaliação" : "avaliações";
        const prev = res.previousRating != null ? String(res.previousRating) : null;
        const prevDate = res.previousRatingDate || null;

        const trackWithImage = {
          trackId: res.trackId,
          trackName: trackName,
          image: imageUrl,
        };

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

        const ratingsByUser = res.ratingsByUser || [];
        const lineWho =
          ratingsByUser.length > 0
            ? "👥 Quem avaliou: " +
              ratingsByUser
                .map(
                  (r) =>
                    `${r.displayName || "?"}: ${Number(r.rating).toFixed(1)}`
                )
                .join(", ")
            : "";

        const block = `🎶 ${trackName}\n👤 Artista: ${artist}\n💿 Álbum: ${
          album || "Desconhecido"
        }\n\n${lineNota}\n${lineMedia}${lineWho ? "\n" + lineWho : ""}`;

        const registroLabel = fromApp
          ? "✅ Nota registrada pelo DogBubble!"
          : "✅ Nota registrada!";
        const atualizadaLabel = fromApp
          ? "✅ Nota atualizada pelo DogBubble!"
          : "✅ Nota atualizada!";

        let confirmationText = block;
        if (noteCreated) {
          if (prev != null) {
            const prevDateStr = prevDate
              ? new Intl.DateTimeFormat("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                }).format(new Date(prevDate))
              : null;
            confirmationText = `${atualizadaLabel}\n${block}\n\n🔁 Sua nota anterior: ${prev}${
              prevDateStr ? " — em " + prevDateStr : ""
            }`;
          } else {
            confirmationText = `${registroLabel}\n${block}`;
          }
        }

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
