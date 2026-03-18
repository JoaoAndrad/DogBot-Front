/**
 * commands/misc/filme.js — Get movie/series info
 * Usage: /filme nome_do_filme
 */

const movieClient = require("../../services/movieClient");

module.exports = {
  name: "filme",
  pattern: /^\/filme\s+(.+)/i,
  description: "📽️ Search and show movie/series info",

  async handler(client, msg, match) {
    try {
      const chatId = msg.from;
      const userId = msg.from;
      const query = match[1]?.trim();

      if (!query) {
        return client.sendMessage(
          chatId,
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
        return client.sendMessage(
          chatId,
          `❌ Nenhum filme encontrado para: ${query}`,
        );
      }

      const movie = searchResults[0];

      // Get full info
      let info;
      try {
        info = await movieClient.getMovieInfo(movie.tmdbId);
      } catch {
        // Fallback if user rating fetch fails
        info = movie;
      }

      // Format response
      const title = `*${info.title}*`;
      const year = info.year ? ` (${info.year})` : "";
      const rating = info.voteAverage
        ? `\n⭐ *TMDb Rating:* ${(info.voteAverage / 2).toFixed(1)}/5`
        : "";
      const overview = info.overview ? `\n\n${info.overview}` : "";
      const userRating =
        info.userRating && info.userRating.rating
          ? `\n👤 *Your Rating:* ${info.userRating.rating}/5`
          : "";
      const watched =
        info.userRating && info.userRating.watched
          ? `\n✅ *Watched:* Sim`
          : "\n❌ *Watched:* Não";

      const message =
        `📽️ ${title}${year}${rating}${overview}${watched}${userRating}` +
        `\n\n💡 Use /assisti ${movie.tmdbId} para marcar como assistido` +
        `\n💡 Use /avaliacao ${movie.tmdbId} para avaliar`;

      return client.sendMessage(chatId, message);
    } catch (err) {
      console.error("[Filme Command] Error:", err.message);
      return client.sendMessage(
        msg.from,
        `❌ Erro ao buscar filme: ${err.message}`,
      );
    }
  },
};
