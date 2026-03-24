/**
 * Desambiguação de livros — espelho de filmSearchFlow.
 */

const { createFlow } = require("../flowBuilder");
const bookClient = require("../../../services/bookClient");
const flowManager = require("../flowManager");
const { formatBookCardMessage } = require("../../../utils/bookCardFormatter");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../../utils/stickerHelper");
const logger = require("../../../utils/logger");

const bookSearchFlow = createFlow("book-search", {
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
        handler: "selectBook",
        data: { workId: c.workId },
      }));
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
      let bookInfo;
      try {
        bookInfo = await bookClient.getBookInfoWithAllRatings(workId, userId);
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
