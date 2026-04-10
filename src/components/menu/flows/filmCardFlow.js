/**
 * components/menu/flows/filmCardFlow.js — Flow do cartão do filme (enquete após /filme)
 * Opções conforme estado: marcar assistido / mais uma visualização; avaliar / alterar avaliação.
 * Avaliar chama markWatched antes de rateMovie (marca como visto automaticamente).
 */

const { createFlow } = require("../flowBuilder");
const movieClient = require("../../../services/movieClient");
const listClient = require("../../../services/listClient");
const flowManager = require("../flowManager");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../../utils/stickerHelper");
const logger = require("../../../utils/logger");
const { truncateForPoll } = require("../../../utils/titleNormalize");
const { formatDateDdMmYyyy } = require("../../../utils/parseViewingDatePtBr");
const conversationState = require("../../../services/conversationState");

function clearViewingDateFlags(state) {
  const c = state?.context;
  if (!c) return;
  delete c.awaitingViewingDateText;
  delete c.pendingViewingDateIso;
  delete c.flowViewingLogIds;
}

/** In-memory (como list-creation): UUID + chatId para o handler de texto encontrar o fluxo */
function registerFilmViewingDateWait(ctx) {
  const { userId, chatId } = ctx;
  const keys = new Set([userId]);
  if (chatId) keys.add(chatId);
  conversationState.startFlowWithAliases([...keys], "film-viewing-date", {
    filmCardStorageUserId: userId,
    chatId,
  });
}

function clearFilmViewingDateConversation(ctx) {
  const { userId, chatId } = ctx;
  [userId, chatId].filter(Boolean).forEach((k) => {
    if (conversationState.getState(k)?.flowType === "film-viewing-date") {
      conversationState.clearState(k);
    }
  });
}

function filmWorkLabel(ctx, movieInfo) {
  const ft = ctx.state?.context?.filmTitle;
  if (ft && String(ft).trim()) return String(ft).trim();
  const t =
    movieInfo?.title && String(movieInfo.title).trim()
      ? String(movieInfo.title).trim()
      : null;
  if (!t) return "esta obra";
  const y = movieInfo?.year;
  return y != null && String(y).trim() !== ""
    ? `${t} (${String(y).trim()})`
    : t;
}

const RATING_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

function formatRatingForMenu(num) {
  if (num == null || Number.isNaN(Number(num))) return "";
  const n = Number(num);
  return n % 1 === 0 ? String(Math.round(n)) : String(n);
}

/** Deriva estado do usuário a partir de movieInfo.userRating (API /ratings?userId=) */
function getViewerListState(movieInfo) {
  const ur = movieInfo?.userRating;
  const watched = Boolean(ur?.watched);
  const r = ur?.rating;
  const hasRating = r != null && Number(r) > 0;
  return {
    watched,
    hasRating,
    ratingDisplay: hasRating ? formatRatingForMenu(r) : "",
    alreadyEngaged: watched || hasRating,
  };
}

async function refreshMovieCardContext(state, tmdbId, userId) {
  if (!tmdbId || !userId) return;
  try {
    const refreshed = await movieClient.getMovieInfoWithAllRatings(
      tmdbId,
      userId,
    );
    state.context.movieInfo = refreshed;
  } catch (err) {
    logger.warn("[FilmCardFlow] refresh movieInfo:", err.message);
  }
}

function listsSyncSuffix(sync) {
  const n = sync?.listsUpdated;
  if (n == null || n < 1) return "";
  return `\n\n📋 Também atualizado em ${n} lista(s).`;
}

/** Alinha itens em listas ao mesmo assistido/nota (escopo DM vs grupo). */
async function trySyncMovieLists(ctx, { watched, rating }) {
  const { userId, chatId, state } = ctx;
  const tmdbId = state?.context?.tmdbId;
  if (!userId || !chatId || !tmdbId) return {};
  try {
    const payload = {
      listKind: "movie",
      externalId: String(tmdbId),
      watched,
    };
    if (rating !== undefined && rating !== null) {
      payload.rating = rating;
    }
    return await listClient.syncFromDirectRating(userId, chatId, payload);
  } catch (e) {
    logger.warn("[FilmCardFlow] sync lists from /filme:", e.message);
    return {};
  }
}

const filmCardFlow = createFlow("film-card", {
  root: {
    title: "💡 O que deseja fazer?",
    dynamic: true,
    handler: async (ctx) => {
      const movieInfo = ctx.state?.context?.movieInfo;
      if (!movieInfo) {
        return {
          title:
            "❌ Contexto do filme não encontrado. Use /filme novamente para começar.",
          skipPoll: true,
        };
      }
      const { alreadyEngaged, hasRating, ratingDisplay } =
        getViewerListState(movieInfo);
      const options = [];
      if (!alreadyEngaged) {
        options.push({
          label: "✅ Marcar como assistido",
          action: "exec",
          handler: "markWatchedFilm",
        });
      } else {
        const work = filmWorkLabel(ctx, movieInfo);
        options.push({
          label: truncateForPoll(
            `📽️ Registrar mais uma visualização para "${work}"`,
          ),
          action: "exec",
          handler: "markWatchedFilm",
        });
      }
      const rateLabel = hasRating
        ? `⭐ Alterar avaliação (atual: ${ratingDisplay}/5)`
        : "⭐ Avaliar";
      options.push(
        { label: rateLabel, action: "exec", handler: "askRatingFilm" },
        {
          label: "📋 Adicionar à lista",
          action: "exec",
          handler: "addFilmToList",
        },
      );
      return {
        title: "💡 O que deseja fazer?",
        options,
      };
    },
  },

  "/after-watch-prompt": {
    title:
      "📅 Deseja alterar a data que viu esse filme?",
    options: [
      {
        label: "Sim",
        action: "exec",
        handler: "startViewingDateInput",
      },
      {
        label: "Ignorar / Manter data atual",
        action: "exec",
        handler: "skipViewingDateAdjust",
      },
    ],
  },

  "/viewing-date-confirm": {
    dynamic: true,
    handler: async (ctx) => {
      const iso = ctx.state?.context?.pendingViewingDateIso;
      if (!iso) {
        return {
          title: "❌ Data não encontrada. Use /filme de novo.",
          skipPoll: true,
        };
      }
      const label = formatDateDdMmYyyy(new Date(iso));
      return {
        title: `Confirma a data *${label}* para esta visualização?`,
        options: [
          {
            label: "✅ Confirmar",
            action: "exec",
            handler: "confirmViewingDate",
          },
          {
            label: "📅 Enviar outra data",
            action: "exec",
            handler: "retryViewingDateInput",
          },
        ],
      };
    },
  },

  "/rating": {
    title: "Sua nota (0,5 a 5):",
    dynamic: true,
    handler: async (ctx) => {
      const movieInfo = ctx.state?.context?.movieInfo;
      const { hasRating, ratingDisplay } = getViewerListState(movieInfo);
      const title = hasRating
        ? `Alterar sua nota (atual: ${ratingDisplay}/5)`
        : "Sua nota (0,5 a 5):";
      return {
        title,
        options: [
          ...RATING_OPTIONS.map((r) => ({
            label: `${r}⭐`,
            action: "exec",
            handler: "rateFilm",
            data: { rating: r },
          })),
          { label: "🔙 Voltar", action: "back" },
        ],
      };
    },
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
        state.context.flowViewingLogIds = [];
        const mw = await movieClient.markWatched(userId, tmdbId, {
          title: movieInfo.title,
          year: movieInfo.year,
          posterUrl: movieInfo.posterUrl,
        });
        if (mw?.viewingLogId) state.context.flowViewingLogIds.push(mw.viewingLogId);
        const displayName = ctx.voterDisplayName || "Você";
        const sync = await trySyncMovieLists(ctx, { watched: true });
        await ctx.reply(
          `✅ *${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}*\n\nMarcado como assistido para *${displayName}*! 🎬${listsSyncSuffix(sync)}`,
        );
      } catch (err) {
        logger.error("[FilmCardFlow] markWatched error:", err.message);
        await ctx.reply(`❌ Erro ao marcar como assistido: ${err.message}`);
        return { end: true };
      }
      state.path = "/after-watch-prompt";
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
        state.context.flowViewingLogIds = [];
        // Marca como visto automaticamente ao avaliar (alinhado ao /filme e listas)
        const mw = await movieClient.markWatched(userId, tmdbId, {
          title: movieInfo.title,
          year: movieInfo.year,
          posterUrl: movieInfo.posterUrl,
        });
        if (mw?.viewingLogId) state.context.flowViewingLogIds.push(mw.viewingLogId);
        const rm = await movieClient.rateMovie(userId, tmdbId, numRating, {
          title: movieInfo.title,
          year: movieInfo.year,
          posterUrl: movieInfo.posterUrl,
        });
        if (rm?.viewingLogId) state.context.flowViewingLogIds.push(rm.viewingLogId);
        const sync = await trySyncMovieLists(ctx, {
          watched: true,
          rating: numRating,
        });
        const stars = "⭐".repeat(Math.round(numRating));
        const displayName = ctx.voterDisplayName || "Você";
        const ratingStr =
          numRating % 1 === 0
            ? String(Math.round(numRating))
            : String(numRating);
        await ctx.reply(
          `⭐ *${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ""}*\n\n${stars} ${ratingStr}/5\n\n✅ Avaliação salva para *${displayName}* com sucesso!\n✅ Também marcado como visto.${listsSyncSuffix(sync)}`,
        );
        if (movieInfo.posterUrl) {
          try {
            const posterBuffer = await downloadImageToBuffer(
              movieInfo.posterUrl,
            );
            if (posterBuffer) {
              await sendBufferAsSticker(client, chatId, posterBuffer, {
                fullOnly: true,
              });
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
      state.path = "/after-watch-prompt";
      return { end: false };
    },

    skipViewingDateAdjust: async (ctx) => {
      const { userId, state } = ctx;
      const { tmdbId } = state.context || {};
      clearFilmViewingDateConversation(ctx);
      clearViewingDateFlags(state);
      if (tmdbId) {
        await refreshMovieCardContext(state, tmdbId, userId);
      }
      state.path = "/";
      return { end: false };
    },

    startViewingDateInput: async (ctx) => {
      ctx.state.context.awaitingViewingDateText = true;
      registerFilmViewingDateWait(ctx);
      await ctx.reply(
        "📝 *Envie a data* em que assistiu (uma mensagem só):\n\n" +
          "• `12/08/26` ou `12/08/2026`\n" +
          "• `12/08` ou `12/8` (usa o ano atual)\n" +
          "• *hoje*, *ontem*, *antes de ontem*\n\n" +
          "_Fuso: Brasil (horário de Brasília)._",
      );
      // Não reenviar a enquete do nó atual; aguardar mensagem de texto (flowManager).
      return { end: false, noRender: true };
    },

    retryViewingDateInput: async (ctx) => {
      delete ctx.state.context.pendingViewingDateIso;
      ctx.state.context.awaitingViewingDateText = true;
      registerFilmViewingDateWait(ctx);
      await ctx.reply("📝 Envie a *nova* data (mesmo formato de antes).");
      return { end: false, noRender: true };
    },

    confirmViewingDate: async (ctx) => {
      const { userId, state } = ctx;
      const { tmdbId, pendingViewingDateIso } = state.context || {};
      if (!tmdbId || !pendingViewingDateIso) {
        await ctx.reply("❌ Dados da data perdidos. Use /filme de novo.");
        clearFilmViewingDateConversation(ctx);
        clearViewingDateFlags(state);
        state.path = "/";
        return { end: false };
      }
      try {
        await movieClient.patchViewingLog(
          userId,
          tmdbId,
          pendingViewingDateIso,
          state.context.flowViewingLogIds,
        );
        const label = formatDateDdMmYyyy(new Date(pendingViewingDateIso));
        await ctx.reply(`✅ Data da visualização atualizada para *${label}*.`);
      } catch (err) {
        logger.error("[FilmCardFlow] confirmViewingDate:", err.message);
        await ctx.reply(
          `❌ Não foi possível salvar a data: ${err.message || err}`,
        );
      }
      clearFilmViewingDateConversation(ctx);
      clearViewingDateFlags(state);
      await refreshMovieCardContext(state, tmdbId, userId);
      state.path = "/";
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
