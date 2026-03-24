/**
 * commands/misc/livro.js — Buscar livro (Open Library)
 * Uso: /livro nome ou /livro OL45883W
 */

const bookClient = require("../../services/bookClient");
const flowManager = require("../../components/menu/flowManager");
const { formatBookCardMessage } = require("../../utils/bookCardFormatter");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../utils/stickerHelper");
const logger = require("../../utils/logger");

function extractWorkIdFromQuery(query) {
  let s = String(query).trim().replace(/^ol:/i, "");
  const m = s.match(/OL\d+W/i);
  if (!m) return null;
  const id = m[0].toUpperCase();
  return /^OL\d+W$/.test(id) ? id : null;
}

module.exports = {
  name: "livro",
  aliases: ["book", "livros"],
  description: "📖 Buscar livro e ver cartão (Open Library)",

  async execute(ctx) {
    try {
      const msg = ctx.message;
      const reply = ctx.reply;
      const info = ctx.info || {};
      const client = ctx.client;

      let userId = info.from || msg.from;
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          userId = contact.id._serialized;
        }
      } catch (err) {
        logger.warn(`[Livro] getContact failed: ${err.message}`);
      }

      const text = (msg.body || "").trim();
      const query = text.replace(/^\/(livro|book|livros)\s*/i, "").trim();

      if (!query) {
        return reply(
          "📖 *Como usar o /livro*\n\n" +
            "• _Buscar por nome:_\n`/livro Romeu e Julieta`\n" +
            "• _Buscar por ID da obra (Open Library, na URL openlibrary.org/works/…):_\n`/livro OL2160489W`\n\n" +
            "Ex.: https://openlibrary.org/works/OL2160489W → `/livro OL2160489W`",
        );
      }

      const directWorkId = extractWorkIdFromQuery(query);
      if (directWorkId) {
        let bookInfo;
        try {
          bookInfo = await bookClient.getBookInfoWithAllRatings(
            directWorkId,
            userId,
          );
        } catch (e) {
          return reply(`❌ Livro com ID ${directWorkId} não encontrado.`);
        }

        await reply(formatBookCardMessage(bookInfo));
        if (bookInfo.posterUrl) {
          try {
            const buf = await downloadImageToBuffer(bookInfo.posterUrl);
            if (buf) {
              await sendBufferAsSticker(client, msg.from, buf, {
                fullOnly: true,
              });
            }
          } catch (err) {
            logger.warn(`[Livro] sticker: ${err.message}`);
          }
        }
        const bookTitle = `${bookInfo.title}${bookInfo.year ? ` (${bookInfo.year})` : ""}`;
        try {
          await flowManager.startFlow(client, msg.from, userId, "book-card", {
            initialContext: {
              workId: bookInfo.workId,
              bookInfo,
              bookTitle,
            },
          });
        } catch (err) {
          logger.warn(`[Livro] book-card: ${err.message}`);
        }
        return;
      }

      await reply(`🔍 Procurando por "${query}" no meu banco de dados...`);

      const searchResp = await bookClient.searchBooks(query, 12);
      const searchResults = searchResp.results || [];
      if (!searchResults.length) {
        return reply(`❌ Nenhum livro encontrado para: ${query}`);
      }

      const ambiguous = searchResults.length >= 2 && query.length <= 20;
      if (ambiguous) {
        const candidates = searchResults.slice(0, 5).map((r) => ({
          workId: r.workId,
          title: r.title,
          year: r.year,
          posterUrl: r.posterUrl ?? null,
        }));
        await reply(
          "Se não estiver na lista, busque em https://openlibrary.org e envie o código da obra (ex.: `/livro OL2160489W`).",
        );
        try {
          await flowManager.startFlow(client, msg.from, userId, "book-search", {
            initialContext: { candidates, userId },
          });
        } catch (err) {
          logger.warn(`[Livro] book-search: ${err.message}`);
        }
        return;
      }

      const book = searchResults[0];
      let bookInfo;
      try {
        bookInfo = await bookClient.getBookInfoWithAllRatings(
          book.workId,
          userId,
          {
            title: book.title,
            year: book.year,
            posterUrl: book.posterUrl,
          },
        );
      } catch {
        bookInfo = book;
      }

      await reply(formatBookCardMessage(bookInfo));
      if (bookInfo.posterUrl) {
        try {
          const buf = await downloadImageToBuffer(bookInfo.posterUrl);
          if (buf) {
            await sendBufferAsSticker(client, msg.from, buf, {
              fullOnly: true,
            });
          }
        } catch (err) {
          logger.warn(`[Livro] sticker: ${err.message}`);
        }
      }

      const bookTitle = `${bookInfo.title}${bookInfo.year ? ` (${bookInfo.year})` : ""}`;
      try {
        await flowManager.startFlow(client, msg.from, userId, "book-card", {
          initialContext: {
            workId: book.workId,
            bookInfo,
            bookTitle,
          },
        });
      } catch (err) {
        logger.warn(`[Livro] book-card: ${err.message}`);
      }
    } catch (err) {
      console.error("[Livro] Error:", err.message);
      return ctx.reply(`❌ Erro ao buscar livro: ${err.message}`);
    }
  },
};
