/**
 * commands/misc/avaliacao.js — Rate a movie/series
 * Usage: /avaliacao tmdbId
 * Flow: search movie → confirm → send poll (1-5 stars) → save rating
 */

const movieClient = require("../../services/movieClient");

module.exports = {
  name: "avaliacao",
  pattern: /^\/avaliacao\s+(\d+|\S+)/i,
  description: "⭐ Rate a movie/series (1-5 stars)",

  async handler(client, msg, match) {
    try {
      const chatId = msg.from;
      const userId = msg.from;
      const input = match[1]?.trim();

      if (!input) {
        return client.sendMessage(
          chatId,
          "❌ Usage: /avaliacao tmdbId\n\nExample: /avaliacao 27205",
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

      // Send poll for rating
      const title =
        `⭐ Como você avalia *${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}*?\n\n` +
        `Selecione uma nota de 1 a 5 estrelas`;

      const options = [
        { name: "⭐ 1 - Péssimo", value: "1" },
        { name: "⭐⭐ 2 - Ruim", value: "2" },
        { name: "⭐⭐⭐ 3 - Regular", value: "3" },
        { name: "⭐⭐⭐⭐ 4 - Bom", value: "4" },
        { name: "⭐⭐⭐⭐⭐ 5 - Excelente", value: "5" },
      ];

      const poll = await client.sendPoll(chatId, title, options, {
        allowMultipleAnswers: false,
      });

      // Store poll context for later
      if (global.pollContexts === undefined) {
        global.pollContexts = {};
      }

      global.pollContexts[poll.id] = {
        type: "movie_rating",
        tmdbId,
        movieTitle: movieInfo.title,
        year: movieInfo.year,
        posterUrl: movieInfo.posterUrl,
        userId,
        chatId,
      };

      return null;
    } catch (err) {
      console.error("[Avaliacao Command] Error:", err.message);
      return client.sendMessage(
        msg.from,
        `❌ Erro ao criar avaliação: ${err.message}`,
      );
    }
  },

  /**
   * Handle poll response
   */
  async handlePollResponse(client, pollResponse, context) {
    try {
      const rating = parseInt(context?.movieTitle ? pollResponse.votes[0] : 0);

      if (!rating || rating < 1 || rating > 5) {
        return client.sendMessage(
          context.chatId,
          "❌ Nota inválida. Por favor selecione de 1 a 5.",
        );
      }

      // Save rating
      await movieClient.rateMovie(context.tmdbId, rating, {
        title: context.movieTitle,
        year: context.year,
        posterUrl: context.posterUrl,
      });

      const message =
        `⭐ *${context.movieTitle}${context.year ? ` (${context.year})` : ""}*\n` +
        `Sua avaliação: ${"⭐".repeat(rating)} ${rating}/5\n\n` +
        `✅ Filme salvo com sucesso!`;

      return client.sendMessage(context.chatId, message);
    } catch (err) {
      console.error("[Avaliacao Handler] Error:", err.message);
      return client.sendMessage(
        context.chatId,
        `❌ Erro ao salvar avaliação: ${err.message}`,
      );
    }
  },
};
