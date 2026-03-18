/**
 * commands/misc/avaliacao.js — Rate a movie/series
 * Usage: /avaliacao tmdbId rating (1-5)
 * Or: /avaliacao tmdbId (will ask for rating)
 */

const movieClient = require("../../services/movieClient");

module.exports = {
  name: "avaliacao",
  description: "⭐ Rate a movie/series (1-5 stars)",

  async execute(ctx) {
    try {
      const msg = ctx.message;
      const reply = ctx.reply;
      const info = ctx.info || {};

      const userId = info.from || msg.from;

      // Extract from message text
      const text = msg.body || "";
      const parts = text
        .replace(/^\/avaliacao\s+/i, "")
        .trim()
        .split(/\s+/);
      const input = parts[0];
      const ratingArg = parts[1];

      if (!input) {
        return reply(
          "❌ Use: /avaliacao (nome do filme) + nota (de 1 a 5))\n\n" +
            "Exemplo:\n" +
            "/avaliacao Inception 4",
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
          return reply(`❌ Nenhum filme encontrado para: ${input}`);
        }

        const movie = searchResults[0];
        tmdbId = movie.tmdbId;
        movieInfo = movie;
      } else {
        // Fetch details by ID
        try {
          movieInfo = await movieClient.getMovieInfo(userId, tmdbId);
        } catch {
          return reply(`❌ Filme com ID ${tmdbId} não encontrado`);
        }
      }

      // Check if rating was provided
      if (!ratingArg) {
        return reply(
          `📽️ *${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}*\n\n` +
            `Responda com a nota de 1 a 5:\n` +
            `/avaliacao ${tmdbId} 1\n` +
            `/avaliacao ${tmdbId} 2\n` +
            `/avaliacao ${tmdbId} 3\n` +
            `/avaliacao ${tmdbId} 4\n` +
            `/avaliacao ${tmdbId} 5`,
        );
      }

      // Validate rating
      const rating = parseInt(ratingArg);
      if (isNaN(rating) || rating < 1 || rating > 5) {
        return reply("❌ Nota inválida. Por favor, use um número de 1 a 5.");
      }

      // Save rating
      await movieClient.rateMovie(userId, tmdbId, rating, {
        title: movieInfo.title,
        year: movieInfo.year,
        posterUrl: movieInfo.posterUrl,
      });

      const message =
        `⭐ *${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}*\n` +
        `Sua avaliação: ${"⭐".repeat(rating)} ${rating}/5\n\n` +
        `✅ Filme salvo com sucesso!`;

      return reply(message);
    } catch (err) {
      console.error("[Avaliacao Command] Error:", err.message);
      return ctx.reply(`❌ Erro ao salvar avaliação: ${err.message}`);
    }
  },
};
