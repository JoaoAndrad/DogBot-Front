/**
 * commands/misc/livro.js — Buscar livro (Open Library por nome; Google Livros para gb:/ISBN)
 * Uso: /livro nome | /livro ol:OL…W | /livro gb:… | URL books.google | ISBN
 */

const bookClient = require("../../services/bookClient");
const flowManager = require("../../components/menu/flowManager");
const { formatBookCardMessage } = require("../../utils/bookCardFormatter");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../utils/stickerHelper");
const logger = require("../../utils/logger");
const { truncateForPoll } = require("../../utils/titleNormalize");

/** Lista de enquete: título, ano e opcionalmente editora (metadados da API). */
function formatBookPollLine(title, year, publisher) {
  const t = String(title || "").trim() || "Sem título";
  const y = year != null && String(year).trim() !== "" ? String(year).trim() : "";
  const pub = publisher != null && String(publisher).trim() ? String(publisher).trim() : "";
  let line = y ? `${t} (${y})` : t;
  if (pub) line += ` · ${pub}`;
  return line;
}

function uniqueCandidatesByWorkId(results) {
  const seen = new Set();
  const out = [];
  for (const r of results || []) {
    const id = r && r.workId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

function extractDirectBookIdFromQuery(query) {
  const s = String(query || "").trim();
  if (!s) return null;
  if (/^gb:/i.test(s)) {
    const rest = s.replace(/^gb:/i, "").trim();
    if (/^[a-zA-Z0-9_-]{4,64}$/.test(rest)) return rest;
    return null;
  }
  const urlMatch = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const olPart = s.replace(/^ol:/i, "").trim();
  const olM = olPart.match(/\bOL\d+W\b/i);
  if (olM) {
    const id = olM[0].toUpperCase();
    return /^OL\d+W$/.test(id) ? id : null;
  }
  const isbn = s.replace(/[-\s]/g, "").toUpperCase();
  if (/^(97[89]\d{10}|\d{10}|\d{9}X)$/.test(isbn)) return s.trim();
  return null;
}

module.exports = {
  name: "livro",
  aliases: ["book", "livros"],
  description: "📖 Buscar livro e ver cartão (Open Library)",

  async execute(ctx) {
    const t0 = Date.now();
    try {
      const msg = ctx.message;
      const reply = ctx.reply;
      const info = ctx.info || {};
      const client = ctx.client;
      const chatId = msg.from;

      /* Em grupo, msg.from é o @g.us; o autor da mensagem é msg.author (como em listas.js). */
      let userId = info.from || msg.author || msg.from;
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

      console.log("[Livro] execute", {
        query: query || "(vazio)",
        chatId,
        userId,
        infoKeys: info && typeof info === "object" ? Object.keys(info) : [],
      });

      if (!query) {
        return reply(
          "📖 *Como usar o /livro*\n\n" +
            "• _Buscar por nome:_\n`/livro Romeu e Julieta` _(Open Library)_\n" +
            "• _ID Open Library:_\n`/livro ol:OL2160489W` ou link `openlibrary.org/works/OL…W`\n" +
            "• _ID Google Livros (opcional):_\n`/livro gb:…` ou link `books.google.com/...id=...`\n" +
            "• _ISBN:_\n`/livro 978-...` _(resolve via Google Livros)_",
        );
      }

      const directWorkId = extractDirectBookIdFromQuery(query);
      if (directWorkId) {
        console.log("[Livro] ramo ID direto", { directWorkId, ms: Date.now() - t0 });
        let bookInfo;
        try {
          bookInfo = await bookClient.getBookInfoWithAllRatings(
            directWorkId,
            userId,
          );
        } catch (e) {
          console.error("[Livro] getBookInfoWithAllRatings falhou", {
            directWorkId,
            message: e.message,
            status: e.status,
          });
          return reply(`❌ Livro não encontrado para: ${directWorkId}`);
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

      const tSearch = Date.now();
      let searchResp;
      try {
        searchResp = await bookClient.searchBooks(query, 12);
      } catch (e) {
        console.error("[Livro] searchBooks exceção", {
          query,
          message: e.message,
          status: e.status,
          body: e.body,
        });
        throw e;
      }
      const searchResults = searchResp.results || [];
      console.log("[Livro] searchBooks ok", {
        query,
        resultCount: searchResults.length,
        ms: Date.now() - tSearch,
        totalMs: Date.now() - t0,
      });

      if (!searchResults.length) {
        console.log("[Livro] sem resultados — a terminar");
        return reply(`❌ Nenhum livro encontrado para: ${query}`);
      }

      const ambiguous = searchResults.length >= 2 && query.length <= 20;
      if (ambiguous) {
        console.log("[Livro] ramo desambiguação (enquete)", {
          candidatos: Math.min(uniqueCandidatesByWorkId(searchResults).length, 5),
        });
        const candidates = uniqueCandidatesByWorkId(searchResults)
          .slice(0, 5)
          .map((r) => ({
            workId: r.workId,
            title: r.title,
            year: r.year,
            publisher: r.publisher ?? null,
            posterUrl: r.posterUrl ?? null,
          }));
        if (candidates.length < 2) {
          const book = uniqueCandidatesByWorkId(searchResults)[0];
          if (!book) {
            return reply(`❌ Nenhum livro encontrado para: ${query}`);
          }
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
          return;
        }
        const listLines = candidates
          .map(
            (c, i) =>
              `${i + 1}. ${truncateForPoll(formatBookPollLine(c.title, c.year, c.publisher))}`,
          )
          .join("\n");
        await reply(
          `📖 *Qual destes?*\n\n${listLines}\n\n` +
            "_Responda à enquete abaixo._\n\n" +
            "Se não estiver na lista, abra https://openlibrary.org e envie `/livro ol:OL…W` (id na URL da obra) ou, se preferir, https://books.google.com com `/livro gb:ID`.",
        );
        try {
          await flowManager.startFlow(client, msg.from, userId, "book-search", {
            initialContext: { candidates, userId },
          });
        } catch (err) {
          logger.warn(`[Livro] book-search: ${err.message}`);
        }
        console.log("[Livro] book-search flow iniciado", { ms: Date.now() - t0 });
        return;
      }

      console.log("[Livro] ramo resultado único", {
        workId: searchResults[0]?.workId,
        title: searchResults[0]?.title,
      });
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
      console.error("[Livro] execute falhou", {
        message: err.message,
        stack: err.stack,
        status: err.status,
        body: err.body,
        ms: Date.now() - t0,
      });
      return ctx.reply(`❌ Erro ao buscar livro: ${err.message}`);
    }
  },
};
