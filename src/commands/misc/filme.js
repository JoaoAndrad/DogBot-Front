/**
 * commands/misc/filme.js — Get movie/series info
 * Usage: /filme nome_do_filme
 */

const movieClient = require("../../services/movieClient");
const flowManager = require("../../components/menu/flowManager");
const { formatFilmCardMessage } = require("../../utils/filmCardFormatter");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../utils/stickerHelper");
const logger = require("../../utils/logger");

module.exports = {
  name: "filme",
  aliases: ["movie", "filmes"],
  description: "📽️ Search and show movie/series info",

  async execute(ctx) {
    try {
      const msg = ctx.message;
      const reply = ctx.reply;
      const info = ctx.info || {};
      const client = ctx.client;

      // Resolve to @c.us so flow state and votes use the same key (like listas.js)
      let userId = info.from || msg.from;
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          userId = contact.id._serialized;
        }
      } catch (err) {
        logger.warn(`[Filme] getContact failed, using raw id: ${err.message}`);
      }

      // Extract query from message text (/filme, /movie, /filmes + optional spaces + rest)
      const text = (msg.body || "").trim();
      const query = text.replace(/^\/(filme|movie|filmes)\s*/i, "").trim();

      if (!query) {
        return reply(
          "📽️ *Como usar o /filme*\n\n" +
            "• _Buscar por nome:_\n`/filme Nome do Filme`\n" +
            "• _Buscar por código TMDb (número na URL do themoviedb.org):_\n`/filme 27205`\n\n" +
            "Exemplos:\n`/filme Inception`\n`/filme 27205`",
        );
      }

      // Query is only digits → treat as tmdbId (direct lookup, no search/disambiguation)
      if (/^\d+$/.test(query)) {
        const tmdbId = query;
        let movieInfo;
        try {
          movieInfo = await movieClient.getMovieInfo(userId, tmdbId);
        } catch (e) {
          return reply(`❌ Filme com ID ${tmdbId} não encontrado.`);
        }
        const message = formatFilmCardMessage(movieInfo);
        await reply(message);
        if (movieInfo.posterUrl) {
          try {
            const posterBuffer = await downloadImageToBuffer(
              movieInfo.posterUrl,
            );
            if (posterBuffer) {
              await sendBufferAsSticker(client, msg.from, posterBuffer, {
                fullOnly: true,
              });
            }
          } catch (err) {
            logger.warn(
              `[Filme] Failed to send poster sticker: ${err.message}`,
            );
          }
        }
        const filmTitle = `${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}`;
        try {
          await flowManager.startFlow(client, msg.from, userId, "film-card", {
            initialContext: { tmdbId, movieInfo, filmTitle },
          });
        } catch (err) {
          logger.warn(`[Filme] Failed to start film-card flow: ${err.message}`);
        }
        return;
      }

      // Search for the movie (only movies, no TV series)
      const searchData = await movieClient.searchMovies(query, {
        type: "movie",
        page: 1,
      });

      const searchResults = searchData.results || [];
      if (!searchResults || searchResults.length === 0) {
        return reply(`❌ Nenhum filme encontrado para: ${query}`);
      }

      // Desambiguação (Opção A): 2+ resultados e query curta → lista "Qual destes?"
      const ambiguous = searchResults.length >= 2 && query.length <= 20;
      if (ambiguous) {
        const candidates = searchResults.slice(0, 5).map((r) => ({
          tmdbId: r.tmdbId ?? r.id,
          title: r.title ?? r.name ?? "",
          year: r.year ?? (r.release_date ? r.release_date.slice(0, 4) : null),
        }));
        // Enviar dica do TMDB logo para não esperar o startFlow (poll)
        await reply(
          "Caso não esteja na lista abaixo, acesse https://www.themoviedb.org/search e envie o código do filme (estará na url) (ex.: /filme 2287).",
        );
        try {
          await flowManager.startFlow(client, msg.from, userId, "film-search", {
            initialContext: { candidates, userId },
          });
        } catch (err) {
          logger.warn(
            `[Filme] Failed to start film-search flow: ${err.message}`,
          );
        }
        return;
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

      const message = formatFilmCardMessage(movieInfo);
      await reply(message);

      // Send poster as sticker if available
      if (movieInfo.posterUrl) {
        try {
          logger.info(`[Filme] Sending poster sticker for ${movieInfo.title}`);
          const posterBuffer = await downloadImageToBuffer(movieInfo.posterUrl);
          if (posterBuffer) {
            await sendBufferAsSticker(client, msg.from, posterBuffer, {
              fullOnly: true,
            });
          }
        } catch (err) {
          logger.warn(`[Filme] Failed to send poster sticker: ${err.message}`);
          // Don't fail the whole command if sticker fails
        }
      }

      // Start film-card flow (poll: Marcar como assistido / Avaliar / Adicionar à lista)
      const filmTitle = `${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}`;
      try {
        await flowManager.startFlow(client, msg.from, userId, "film-card", {
          initialContext: {
            tmdbId: movie.tmdbId,
            movieInfo,
            filmTitle,
          },
        });
      } catch (err) {
        logger.warn(`[Filme] Failed to start film-card flow: ${err.message}`);
      }

      return;
    } catch (err) {
      console.error("[Filme Command] Error:", err.message);
      return ctx.reply(`❌ Erro ao buscar filme: ${err.message}`);
    }
  },
};
