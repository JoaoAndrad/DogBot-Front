/**
 * components/menu/flows/filmSearchFlow.js — Desambiguação: "Qual destes?"
 * Mostra enquete com até 5 resultados; ao escolher, exibe o cartão do filme e inicia film-card.
 */

const { createFlow } = require("../flowBuilder");
const movieClient = require("../../../services/movieClient");
const flowManager = require("../flowManager");
const { formatFilmCardMessage } = require("../../../utils/filmCardFormatter");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../../utils/stickerHelper");
const logger = require("../../../utils/logger");

const filmSearchFlow = createFlow("film-search", {
  root: {
    title: "Qual destes?",
    dynamic: true,
    handler: async (ctx) => {
      const candidates = ctx.state?.context?.candidates || [];
      if (!candidates.length) {
        return {
          title: "❌ Nenhum resultado para escolher",
          options: [],
        };
      }
      const options = candidates.slice(0, 5).map((c) => ({
        label: `${c.title}${c.year ? ` (${c.year})` : ""}`,
        action: "exec",
        handler: "selectFilm",
        data: { tmdbId: c.tmdbId },
      }));
      return {
        title: "Qual destes?",
        options,
      };
    },
  },

  handlers: {
    selectFilm: async (ctx) => {
      const { userId, chatId, client, data } = ctx;
      const tmdbId = data?.tmdbId;
      if (!tmdbId) {
        await ctx.reply("❌ Filme não identificado.");
        return { end: true };
      }
      let movieInfo;
      try {
        movieInfo = await movieClient.getMovieInfo(userId, String(tmdbId));
      } catch (e) {
        await ctx.reply(`❌ Filme com ID ${tmdbId} não encontrado.`);
        return { end: true };
      }
      const message = formatFilmCardMessage(movieInfo);
      await ctx.reply(message);
      if (movieInfo.posterUrl) {
        try {
          const posterBuffer = await downloadImageToBuffer(movieInfo.posterUrl);
          if (posterBuffer) {
            await sendBufferAsSticker(client, chatId, posterBuffer, { fullOnly: true });
          }
        } catch (err) {
          logger.warn(`[FilmSearchFlow] poster sticker: ${err.message}`);
        }
      }
      const filmTitle = `${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}`;
      try {
        await flowManager.startFlow(client, chatId, userId, "film-card", {
          initialContext: { tmdbId: String(tmdbId), movieInfo, filmTitle },
        });
      } catch (err) {
        logger.warn(`[FilmSearchFlow] start film-card: ${err.message}`);
      }
      return { end: true };
    },
  },
});

module.exports = filmSearchFlow;
