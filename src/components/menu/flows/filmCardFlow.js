/**
 * components/menu/flows/filmCardFlow.js — Flow do cartão do filme (enquete após /filme)
 * Opções: Marcar como assistido (se não assistido), Avaliar, Adicionar à lista.
 * Ao marcar ou avaliar, reenvia a enquete (sem "Marcar como assistido").
 */

const { createFlow } = require("../flowBuilder");
const movieClient = require("../../../services/movieClient");
const flowManager = require("../flowManager");
const {
  downloadAndConvertToWebp,
  sendBufferAsSticker,
} = require("../../../utils/stickerHelper");
const logger = require("../../../utils/logger");

const RATING_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const filmCardFlow = createFlow("film-card", {
  root: {
    title: "O que deseja fazer?",
    dynamic: true,
    handler: async (ctx) => {
      const movieInfo = ctx.state?.context?.movieInfo;
      if (!movieInfo) {
        return {
          title: "❌ Erro: contexto do filme não encontrado",
          options: [],
        };
      }
      const watched = movieInfo.userRating && movieInfo.userRating.watched;
      const options = [];
      if (!watched) {
        options.push({
          label: "Marcar como assistido",
          action: "exec",
          handler: "markWatchedFilm",
        });
      }
      options.push(
        { label: "Avaliar", action: "exec", handler: "askRatingFilm" },
        { label: "Adicionar à lista", action: "exec", handler: "addFilmToList" }
      );
      return {
        title: "O que deseja fazer?",
        options,
      };
    },
  },

  "/rating": {
    title: "Sua nota (0,5 a 5):",
    options: RATING_OPTIONS.map((r) => ({
      label: `${r}⭐`,
      action: "exec",
      handler: "rateFilm",
      data: { rating: r },
    })),
  },

  handlers: {
    markWatchedFilm: async (ctx) => {
      const { userId, chatId, client, state } = ctx;
      const { tmdbId, movieInfo, filmTitle } = state.context || {};
      if (!tmdbId || !movieInfo) {
        await ctx.reply("❌ Erro: dados do filme não encontrados.");
        return { end: true };
      }
      try {
        await movieClient.markWatched(userId, tmdbId, {
          title: movieInfo.title,
          year: movieInfo.year,
          posterUrl: movieInfo.posterUrl,
        });
        await ctx.reply(
          `✅ *${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}*\n\nMarcado como assistido! 🎬`
        );
      } catch (err) {
        logger.error("[FilmCardFlow] markWatched error:", err.message);
        await ctx.reply(`❌ Erro ao marcar como assistido: ${err.message}`);
        return { end: true };
      }
      try {
        const refreshed = await movieClient.getMovieInfo(userId, tmdbId);
        state.context.movieInfo = refreshed;
        state.path = "/";
      } catch (err) {
        logger.warn("[FilmCardFlow] refresh after markWatched:", err.message);
      }
      return { end: false };
    },

    askRatingFilm: async (ctx) => {
      ctx.state.path = "/rating";
      return { end: false };
    },

    rateFilm: async (ctx) => {
      const { userId, chatId, client, state, data } = ctx;
      const rating = data?.rating;
      const { tmdbId, movieInfo, filmTitle } = state.context || {};
      if (!tmdbId || !movieInfo || rating == null) {
        await ctx.reply("❌ Erro: dados do filme ou nota não encontrados.");
        return { end: true };
      }
      const numRating = Number(rating);
      if (Number.isNaN(numRating) || numRating < 0.5 || numRating > 5) {
        await ctx.reply("❌ Nota inválida. Use um valor entre 0,5 e 5.");
        return { end: true };
      }
      try {
        await movieClient.markWatched(userId, tmdbId, {
          title: movieInfo.title,
          year: movieInfo.year,
          posterUrl: movieInfo.posterUrl,
        });
        await movieClient.rateMovie(userId, tmdbId, numRating, {
          title: movieInfo.title,
          year: movieInfo.year,
          posterUrl: movieInfo.posterUrl,
        });
        const stars = "⭐".repeat(Math.round(numRating));
        await ctx.reply(
          `⭐ *${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}*\n\n${stars} ${numRating}/5\n\n✅ Avaliação salva com sucesso!`
        );
        if (movieInfo.posterUrl) {
          try {
            const posterBuffer = await downloadAndConvertToWebp(
              movieInfo.posterUrl,
              tmdbId
            );
            if (posterBuffer) {
              await sendBufferAsSticker(client, chatId, posterBuffer);
            }
          } catch (e) {
            logger.warn("[FilmCardFlow] poster sticker:", e.message);
          }
        }
      } catch (err) {
        logger.error("[FilmCardFlow] rateFilm error:", err.message);
        await ctx.reply(`❌ Erro ao salvar avaliação: ${err.message}`);
        return { end: true };
      }
      try {
        const refreshed = await movieClient.getMovieInfo(userId, tmdbId);
        state.context.movieInfo = refreshed;
        state.path = "/";
      } catch (err) {
        logger.warn("[FilmCardFlow] refresh after rate:", err.message);
      }
      return { end: false };
    },

    addFilmToList: async (ctx) => {
      const { userId, chatId, client, state } = ctx;
      const { tmdbId, filmTitle } = state.context || {};
      if (!filmTitle) {
        await ctx.reply("❌ Erro: nome do filme não encontrado.");
        return { end: true };
      }
      try {
        await flowManager.startFlow(client, chatId, userId, "add-film", {
          initialContext: { filmName: filmTitle, tmdbId },
        });
      } catch (err) {
        logger.error("[FilmCardFlow] start add-film:", err.message);
        await ctx.reply(`❌ Erro ao abrir listas: ${err.message}`);
      }
      return { end: true };
    },
  },
});

module.exports = filmCardFlow;
