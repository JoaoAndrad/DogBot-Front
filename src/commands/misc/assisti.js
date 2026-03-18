/**
 * commands/misc/assisti.js — Mark movie as watched
 * Usage: /assisti tmdbId
 */

const movieClient = require("../../services/movieClient");

module.exports = {
  name: "assisti",
  pattern: /^\/assisti\s+(\d+|\S+)/i,
  description: "✅ Mark a movie/series as watched",

  async handler(client, msg, match) {
    try {
      const chatId = msg.from;
      const userId = msg.from;
      const input = match[1]?.trim();

      if (!input) {
        return client.sendMessage(
          chatId,
          "❌ Usage: /assisti tmdbId\n\nExample: /assisti 27205",
        );
      }

      // Determine if input is a number (tmdbId) or a search query
      let tmdbId = input;
      let movieInfo;

      if (isNaN(input)) {
        // Search for the movie
        const searchData = await movieClient.searchMovies(input, {
          type: "multi",
          page: 1,
        });

        const searchResults = searchData.results || [];
        if (!searchResults || searchResults.length === 0) {
          return client.sendMessage(
            chatId,
            `❌ Nenhum filme encontrado para: ${input}`,
          );
        }

        const movie = searchResults[0];
        tmdbId = movie.tmdbId;
        movieInfo = movie;
      } else {
        // Fetch details by ID
        try {
          movieInfo = await movieClient.getMovieInfo(tmdbId);
        } catch {
          return client.sendMessage(
            chatId,
            `❌ Filme com ID ${tmdbId} não encontrado`,
          );
        }
      }

      // Mark as watched
      const result = await movieClient.markWatched(tmdbId, {
        title: movieInfo.title,
        year: movieInfo.year,
        posterUrl: movieInfo.posterUrl,
      });

      const message =
        `✅ *${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}* marcado como assistido!\n\n` +
        `💡 Use /avaliacao ${tmdbId} para avaliar este filme`;

      return client.sendMessage(chatId, message);
    } catch (err) {
      console.error("[Assisti Command] Error:", err.message);
      return client.sendMessage(
        msg.from,
        `❌ Erro ao marcar como assistido: ${err.message}`,
      );
    }
  },
};
