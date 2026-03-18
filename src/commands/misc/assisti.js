/**
 * commands/misc/assisti.js — Mark movie as watched
 * Usage: /assisti tmdbId or /assisti "movie name"
 */

const movieClient = require("../../services/movieClient");

module.exports = {
  name: "assisti",
  description: "✅ Mark a movie/series as watched",

  async execute(ctx) {
    try {
      const msg = ctx.message;
      const reply = ctx.reply;
      const info = ctx.info || {};

      const userId = info.from || msg.from;

      // Extract input from message text
      const text = msg.body || "";
      const input = text.replace(/^\/assisti\s+/i, "").trim();

      if (!input) {
        return reply("❌ Usage: /assisti tmdbId\n\nExample: /assisti 27205");
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
          return reply(`❌ Nenhum filme encontrado para: ${input}`);
        }

        const movie = searchResults[0];
        tmdbId = movie.tmdbId;
        movieInfo = movie;
      } else {
        // Fetch details by ID
        try {
          movieInfo = await movieClient.getMovieInfo(tmdbId);
        } catch {
          return reply(`❌ Filme com ID ${tmdbId} não encontrado`);
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

      return reply(message);
    } catch (err) {
      console.error("[Assisti Command] Error:", err.message);
      return ctx.reply(`❌ Erro ao marcar como assistido: ${err.message}`);
    }
  },
};
