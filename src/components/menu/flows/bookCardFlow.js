/**
 * Flow do cartão do livro (enquete após /livro) — espelho de filmCardFlow.
 */

const { createFlow } = require("../flowBuilder");
const bookClient = require("../../../services/bookClient");
const listClient = require("../../../services/listClient");
const flowManager = require("../flowManager");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../../utils/media/stickerHelper");
const logger = require("../../../utils/logger");
const { truncateForPoll } = require("../../../utils/text/titleNormalize");

function bookWorkLabel(ctx, bookInfo) {
  const bt = ctx.state?.context?.bookTitle;
  if (bt && String(bt).trim()) return String(bt).trim();
  const t = bookInfo?.title && String(bookInfo.title).trim();
  if (!t) return "esta obra";
  const y = bookInfo?.year;
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

function getViewerBookState(bookInfo) {
  const ur = bookInfo?.userRating;
  const read = Boolean(ur?.read ?? ur?.watched);
  const r = ur?.rating;
  const hasRating = r != null && Number(r) > 0;
  return {
    read,
    hasRating,
    ratingDisplay: hasRating ? formatRatingForMenu(r) : "",
    alreadyEngaged: read || hasRating,
  };
}

async function refreshBookCardContext(state, workId, userId) {
  if (!workId || !userId) return;
  const bi = state.context?.bookInfo;
  const fallback =
    bi?.title && String(bi.title).trim()
      ? { title: bi.title, year: bi.year, posterUrl: bi.posterUrl }
      : null;
  try {
    const refreshed = await bookClient.getBookInfoWithAllRatings(
      workId,
      userId,
      fallback,
    );
    state.context.bookInfo = refreshed;
  } catch (err) {
    logger.warn("[BookCardFlow] refresh bookInfo:", err.message);
  }
}

function listsSyncSuffix(sync) {
  const n = sync?.listsUpdated;
  if (n == null || n < 1) return "";
  return `\n\n📋 Também atualizado em ${n} lista(s).`;
}

async function trySyncBookLists(ctx, { watched, rating }) {
  const { userId, chatId, state } = ctx;
  const workId = state?.context?.workId;
  if (!userId || !chatId || !workId) return {};
  try {
    const payload = {
      listKind: "book",
      externalId: String(workId),
      watched,
    };
    if (rating !== undefined && rating !== null) {
      payload.rating = rating;
    }
    return await listClient.syncFromDirectRating(userId, chatId, payload);
  } catch (e) {
    logger.warn("[BookCardFlow] sync lists from /livro:", e.message);
    return {};
  }
}

const bookCardFlow = createFlow("book-card", {
  root: {
    title: "💡 O que deseja fazer?",
    dynamic: true,
    handler: async (ctx) => {
      const bookInfo = ctx.state?.context?.bookInfo;
      if (!bookInfo) {
        return {
          title:
            "❌ Contexto do livro não encontrado. Use /livro novamente para começar.",
          skipPoll: true,
        };
      }
      const { alreadyEngaged, hasRating, ratingDisplay } =
        getViewerBookState(bookInfo);
      const options = [];
      if (!alreadyEngaged) {
        options.push({
          label: "✅ Marcar como lido",
          action: "exec",
          handler: "markReadBook",
        });
      } else {
        const work = bookWorkLabel(ctx, bookInfo);
        options.push({
          label: truncateForPoll(
            `📖 Registrar mais uma leitura para "${work}"`,
          ),
          action: "exec",
          handler: "markReadBook",
        });
      }
      const rateLabel = hasRating
        ? `⭐ Alterar avaliação (atual: ${ratingDisplay}/5)`
        : "⭐ Avaliar";
      options.push(
        { label: rateLabel, action: "exec", handler: "askRatingBook" },
        {
          label: "📋 Adicionar à lista",
          action: "exec",
          handler: "addBookToList",
        },
      );
      return {
        title: "💡 O que deseja fazer?",
        options,
      };
    },
  },

  "/rating": {
    title: "Sua nota (0,5 a 5):",
    dynamic: true,
    handler: async (ctx) => {
      const bookInfo = ctx.state?.context?.bookInfo;
      const { hasRating, ratingDisplay } = getViewerBookState(bookInfo);
      const title = hasRating
        ? `Alterar sua nota (atual: ${ratingDisplay}/5)`
        : "Sua nota (0,5 a 5):";
      return {
        title,
        options: [
          ...RATING_OPTIONS.map((r) => ({
            label: `${r}⭐`,
            action: "exec",
            handler: "rateBookHandler",
            data: { rating: r },
          })),
          { label: "🔙 Voltar", action: "back" },
        ],
      };
    },
  },

  handlers: {
    markReadBook: async (ctx) => {
      const { userId, chatId, client, state } = ctx;
      const { workId, bookInfo } = state.context || {};
      if (!workId || !bookInfo) {
        await ctx.reply("❌ Erro: dados do livro não encontrados.");
        return { end: true };
      }
      try {
        await bookClient.markRead(userId, workId, {
          title: bookInfo.title,
          year: bookInfo.year,
          posterUrl: bookInfo.posterUrl,
        });
        const displayName = ctx.voterDisplayName || "Você";
        const sync = await trySyncBookLists(ctx, { watched: true });
        await ctx.reply(
          `✅ *${bookInfo.title}${bookInfo.year ? ` (${bookInfo.year})` : ""}*\n\nMarcado como lido para *${displayName}*! 📖${listsSyncSuffix(sync)}`,
        );
      } catch (err) {
        logger.error("[BookCardFlow] markRead error:", err.message);
        await ctx.reply(`❌ Erro ao marcar como lido: ${err.message}`);
        return { end: true };
      }
      await refreshBookCardContext(state, workId, userId);
      state.path = "/";
      return { end: false };
    },

    askRatingBook: async (ctx) => {
      ctx.state.path = "/rating";
      return { end: false };
    },

    rateBookHandler: async (ctx) => {
      const { userId, chatId, client, state, data } = ctx;
      const rating = data?.rating;
      const { workId, bookInfo } = state.context || {};
      if (!workId || !bookInfo || rating == null) {
        await ctx.reply("❌ Erro: dados do livro ou nota não encontrados.");
        return { end: true };
      }
      const numRating = Number(rating);
      if (Number.isNaN(numRating) || numRating < 0.5 || numRating > 5) {
        await ctx.reply("❌ Nota inválida. Use um valor entre 0,5 e 5.");
        return { end: true };
      }
      try {
        await bookClient.markRead(userId, workId, {
          title: bookInfo.title,
          year: bookInfo.year,
          posterUrl: bookInfo.posterUrl,
        });
        await bookClient.rateBook(userId, workId, numRating, {
          title: bookInfo.title,
          year: bookInfo.year,
          posterUrl: bookInfo.posterUrl,
        });
        const sync = await trySyncBookLists(ctx, {
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
          `⭐ *${bookInfo.title}${bookInfo.year ? ` (${bookInfo.year})` : ""}*\n\n${stars} ${ratingStr}/5\n\n✅ Avaliação salva para *${displayName}* com sucesso!\n✅ Também marcado como lido.${listsSyncSuffix(sync)}`,
        );
        if (bookInfo.posterUrl) {
          try {
            const posterBuffer = await downloadImageToBuffer(
              bookInfo.posterUrl,
            );
            if (posterBuffer) {
              await sendBufferAsSticker(client, chatId, posterBuffer, {
                fullOnly: true,
              });
            }
          } catch (e) {
            logger.warn("[BookCardFlow] cover sticker:", e.message);
          }
        }
      } catch (err) {
        logger.error("[BookCardFlow] rateBook error:", err.message);
        await ctx.reply(`❌ Erro ao salvar avaliação: ${err.message}`);
        return { end: true };
      }
      await refreshBookCardContext(state, workId, userId);
      state.path = "/";
      return { end: false };
    },

    addBookToList: async (ctx) => {
      const { userId, chatId, client, state } = ctx;
      const { workId, bookTitle } = state.context || {};
      if (!bookTitle || !workId) {
        await ctx.reply("❌ Erro: dados do livro não encontrados.");
        return { end: true };
      }
      try {
        await flowManager.startFlow(client, chatId, userId, "add-book", {
          initialContext: { bookName: bookTitle, workId },
        });
      } catch (err) {
        logger.error("[BookCardFlow] start add-book:", err.message);
        await ctx.reply(`❌ Erro ao abrir listas: ${err.message}`);
      }
      return { end: true };
    },
  },
});

module.exports = bookCardFlow;
