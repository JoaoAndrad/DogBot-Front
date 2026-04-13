/**
 * Desambiguação de livros — espelho de filmSearchFlow.
 */

const { createFlow } = require("../flowBuilder");
const bookClient = require("../../../services/bookClient");
const flowManager = require("../flowManager");
const { formatBookCardMessage } = require("../../../utils/formatters/bookCardFormatter");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../../utils/media/stickerHelper");
const logger = require("../../../utils/logger");
const {
  normalizeBookTitleForList,
  truncateForPoll,
} = require("../../../utils/text/titleNormalize");

function dedupeCandidatesByWorkId(list) {
  const seen = new Set();
  const out = [];
  for (const c of list || []) {
    const id = c && c.workId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(c);
  }
  return out;
}

const bookSearchFlow = createFlow("book-search", {
  root: {
    title: "Qual destes?",
    dynamic: true,
    handler: async (ctx) => {
      const raw = ctx.state?.context?.candidates || [];
      const candidates = dedupeCandidatesByWorkId(raw).slice(0, 5);
      if (!candidates.length) {
        return {
          title: "❌ Nenhum resultado para escolher",
          options: [],
        };
      }
      const usedLabels = new Set();
      const options = candidates.map((c) => {
        let label = truncateForPoll(
          normalizeBookTitleForList(c.title, c.year, c.publisher),
        );
        if (usedLabels.has(label)) {
          label = truncateForPoll(`${label} · ${c.workId || "?"}`);
        }
        usedLabels.add(label);
        return {
          label,
          action: "exec",
          handler: "selectBook",
          data: {
            workId: c.workId,
            title: c.title,
            year: c.year ?? null,
            posterUrl: c.posterUrl ?? null,
          },
        };
      });
      return {
        title: "Qual destes?",
        options,
      };
    },
  },

  handlers: {
    selectBook: async (ctx) => {
      const { userId, chatId, client, data } = ctx;
      const workId = data?.workId;
      if (!workId) {
        await ctx.reply("❌ Livro não identificado.");
        return { end: true };
      }
      const fallback =
        data?.title && String(data.title).trim()
          ? {
              title: data.title,
              year: data.year,
              posterUrl: data.posterUrl,
            }
          : null;
      let bookInfo;
      try {
        bookInfo = await bookClient.getBookInfoWithAllRatings(
          workId,
          userId,
          fallback,
        );
      } catch (e) {
        await ctx.reply(`❌ Livro com ID ${workId} não encontrado.`);
        return { end: true };
      }
      await ctx.reply(formatBookCardMessage(bookInfo));
      if (bookInfo.posterUrl) {
        try {
          const posterBuffer = await downloadImageToBuffer(bookInfo.posterUrl);
          if (posterBuffer) {
            await sendBufferAsSticker(client, chatId, posterBuffer, {
              fullOnly: true,
            });
          }
        } catch (err) {
          logger.warn(`[BookSearchFlow] sticker: ${err.message}`);
        }
      }
      const bookTitle = `${bookInfo.title}${bookInfo.year ? ` (${bookInfo.year})` : ""}`;
      try {
        await flowManager.startFlow(client, chatId, userId, "book-card", {
          initialContext: { workId: bookInfo.workId, bookInfo, bookTitle },
        });
      } catch (err) {
        logger.warn(`[BookSearchFlow] book-card: ${err.message}`);
      }
      return { end: true };
    },
  },
});

module.exports = bookSearchFlow;
