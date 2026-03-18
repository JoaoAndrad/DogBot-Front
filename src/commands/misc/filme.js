/**
 * commands/misc/filme.js — Get movie/series info
 * Usage: /filme nome_do_filme
 */

const movieClient = require("../../services/movieClient");

module.exports = {
  name: "filme",
  description: "📽️ Search and show movie/series info",

  async execute(ctx) {
    try {
      const msg = ctx.message;
      const reply = ctx.reply;
      const info = ctx.info || {};

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
        movieInfo = await movieClient.getMovieInfo(movie.tmdbId);
      } catch {
        // Fallback if user rating fetch fails
        movieInfo = movie;
      }

      // Format response
      const title = `*${movieInfo.title}*`;
      const year = movieInfo.year ? ` (${movieInfo.year})` : "";
      const rating = movieInfo.voteAverage
        ? `\n⭐ *TMDb Rating:* ${(movieInfo.voteAverage / 2).toFixed(1)}/5`
        : "";
      const overview = movieInfo.overview ? `\n\n${movieInfo.overview}` : "";
      const userRating =
        movieInfo.userRating && movieInfo.userRating.rating
          ? `\n👤 *Your Rating:* ${movieInfo.userRating.rating}/5`
          : "";
      const watched =
        movieInfo.userRating && movieInfo.userRating.watched
          ? `\n✅ *Watched:* Sim`
          : "\n❌ *Watched:* Não";

      const message =
        `📽️ ${title}${year}${rating}${overview}${watched}${userRating}` +
        `\n\n💡 Use /assisti ${movie.tmdbId} para marcar como assistido` +
        `\n💡 Use /avaliacao ${movie.tmdbId} para avaliar`;

      return reply(message);
    } catch (err) {
      console.error("[Filme Command] Error:", err.message);
      return ctx.reply(`❌ Erro ao buscar filme: ${err.message}`);
    }
  },
};
