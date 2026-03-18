/**
 * commands/misc/filme.js — Get movie/series info
 * Usage: /filme nome_do_filme
 */

const movieClient = require("../../services/movieClient");
const {
  downloadAndConvertToWebp,
  sendBufferAsSticker,
} = require("../../utils/stickerHelper");
const logger = require("../../utils/logger");

module.exports = {
  name: "filme",
  description: "📽️ Search and show movie/series info",

  async execute(ctx) {
    try {
      const msg = ctx.message;
      const reply = ctx.reply;
      const info = ctx.info || {};
      const client = ctx.client;

      const userId = info.from || msg.from;

      // Extract query from message text
      const text = msg.body || "";
      const query = text.replace(/^\/filme\s+/i, "").trim();

      if (!query) {
        return reply(
          "❌ Usage: /filme nome_do_filme\n\nExample: /filme Inception",
        );
      }

      // Search for the movie
      const searchData = await movieClient.searchMovies(query, {
        type: "multi",
        page: 1,
      });

      const searchResults = searchData.results || [];
      if (!searchResults || searchResults.length === 0) {
        return reply(`❌ Nenhum filme encontrado para: ${query}`);
      }

      const movie = searchResults[0];

      // Get full info
      let movieInfo;
      try {
        movieInfo = await movieClient.getMovieInfo(userId, movie.tmdbId);
      } catch {
        // Fallback if user rating fetch fails
        movieInfo = movie;
      }

      // Format response with improved formatting
      const title = `*${movieInfo.title}*`;
      const year = movieInfo.year ? ` (${movieInfo.year})` : "";
      const rating = movieInfo.voteAverage
        ? `⭐ *TMDb:* ${(movieInfo.voteAverage / 2).toFixed(1)}/5`
        : "⭐ *TMDb:* N/A";
      const watched =
        movieInfo.userRating && movieInfo.userRating.watched
          ? "✅ *Assistido*"
          : "❌ *Assistido*";
      const userRating =
        movieInfo.userRating && movieInfo.userRating.rating
          ? `👤 *Sua nota:* ${"⭐".repeat(movieInfo.userRating.rating)} (${movieInfo.userRating.rating}/5)`
          : "👤 *Sua nota:* Sem avaliação";

      const overview = movieInfo.overview ? movieInfo.overview : "";

      // Build the formatted message
      const message = `📽️ ${title}${year}

${rating}
${watched} | ${userRating}

━━━━━━━━━━━━━━━━━━━━━━
${overview}
━━━━━━━━━━━━━━━━━━━━━━

💡 /assisti ${movie.tmdbId} - Marcar como assistido
💡 /avaliacao ${movie.tmdbId} - Adicionar avaliação`;

      // Send the message
      await reply(message);

      // Send poster as sticker if available
      if (movieInfo.posterUrl) {
        try {
          logger.info(`[Filme] Sending poster sticker for ${movieInfo.title}`);
          const posterBuffer = await downloadAndConvertToWebp(
            movieInfo.posterUrl,
            movie.tmdbId,
          );
          if (posterBuffer) {
            await sendBufferAsSticker(client, msg.from, posterBuffer);
          }
        } catch (err) {
          logger.warn(`[Filme] Failed to send poster sticker: ${err.message}`);
          // Don't fail the whole command if sticker fails
        }
      }

      return;
    } catch (err) {
      console.error("[Filme Command] Error:", err.message);
      return ctx.reply(`❌ Erro ao buscar filme: ${err.message}`);
    }
  },
};
