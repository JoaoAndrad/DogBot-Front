/**
 * Adicionar livro a listas de livros — espelho de addFilmFlow.
 */

const { createFlow } = require("../flowBuilder");
const listClient = require("../../../services/listClient");
const bookClient = require("../../../services/bookClient");
const logger = require("../../../utils/logger");

const addBookFlow = createFlow("add-book", {
  root: {
    title: "📖 Adicionar livro",
    dynamic: true,
    handler: async (ctx) => {
      try {
        const userId = ctx.userId;
        const bookName = ctx.state?.context?.bookName;
        const workId = ctx.state?.context?.workId;

        let book;
        let bookTitle;

        if (workId) {
          logger.info(`[AddBookFlow] workId: ${workId}`);
          try {
            book = await bookClient.getBookInfo(userId, workId);
            bookTitle =
              ctx.state.context.bookTitle ||
              `${book.title}${book.year ? ` (${book.year})` : ""}`;
            ctx.state.context.workId = book.workId || workId;
            ctx.state.context.bookTitle = bookTitle;
            ctx.state.context.bookData = book;
          } catch (err) {
            logger.warn(`[AddBookFlow] Livro não encontrado: ${workId}`);
            return {
              title: `❌ *Livro não encontrado* (${workId})`,
              options: [{ label: "🔙 Voltar", action: "back" }],
            };
          }
        } else {
          if (!bookName) {
            return {
              title: "❌ *Erro:* Nome do livro não fornecido.",
              options: [{ label: "🔙 Voltar", action: "back" }],
            };
          }

          const searchResp = await bookClient.searchBooks(bookName, 8);
          const results = searchResp.results || [];
          if (!results.length) {
            return {
              title: `❌ *Nenhum livro encontrado* para "${bookName}"`,
              options: [{ label: "🔙 Voltar", action: "back" }],
            };
          }

          book = results[0];
          bookTitle = `${book.title}${book.year ? ` (${book.year})` : ""}`;
          ctx.state.context.workId = book.workId;
          ctx.state.context.bookTitle = bookTitle;
          ctx.state.context.bookData = book;
        }

        const chatId = ctx.chatId || ctx.from;
        const isGroup = chatId && String(chatId).endsWith("@g.us");
        const groupChatId = isGroup ? chatId : null;

        const allLists = await listClient.getUserLists(
          userId,
          1,
          groupChatId,
          "book",
        );
        const lists = allLists.filter((l) => (l.listKind || "book") === "book");

        if (lists.length === 0) {
          const msgPrivate =
            `📖 *${bookTitle}*\n\n` +
            `*Você não tem listas de livros!*\n\n` +
            `Abra \`/listas\`, crie uma lista e responda *livros* quando o bot perguntar o tipo.\n\n` +
            `_Listas de filmes não aparecem aqui._`;
          const msgGroup =
            `📖 *${bookTitle}*\n\n` +
            `*Não há listas de livros neste grupo.*\n\n` +
            `Crie uma em \`/listas\` (tipo *livros*).`;
          return {
            title: isGroup ? msgGroup : msgPrivate,
            skipPoll: true,
          };
        }

        ctx.state.context.lists = lists;

        const olTmdbId = `ol:${book.workId || ctx.state.context.workId}`;

        const options = lists.map((list) => {
          const optionData = {
            listId: list.id,
            listIndex: lists.indexOf(list),
            tmdbId: olTmdbId,
            bookTitle,
            bookData: book,
          };
          return {
            label:
              `📋 ${list.title} (${list._count?.items ?? 0} items)` +
              (isGroup && list.owner ? ` - ${list.owner.push_name}` : ""),
            action: "exec",
            handler: "selectList",
            data: optionData,
          };
        });
        options.push({ label: "🔙 Voltar", action: "back" });

        return {
          title: `📖 *${bookTitle}*\n\n_Selecione uma lista de livros:_`,
          options,
          skipPoll: false,
        };
      } catch (err) {
        logger.error("[AddBookFlow] Root error:", err.message);
        return {
          title:
            "❌ *Erro ao buscar livro.*\n\nUse \`/listas\` para ver suas listas.",
          skipPoll: true,
        };
      }
    },
  },

  handlers: {
    selectList: async (ctx) => {
      try {
        const { listId, tmdbId, bookTitle, bookData } = ctx.data || {};

        if (!listId || !tmdbId) {
          await ctx.reply(
            "❌ *Erro* ao processar seleção (dados incompletos).",
          );
          return { end: false };
        }

        const payload = {
          title:
            bookData?.title || bookTitle?.split("(")[0].trim() || "Unknown",
          year: bookData?.year,
          posterUrl: bookData?.posterUrl,
          mediaType: "book",
        };

        await listClient.addToList(listId, tmdbId, ctx.userId, payload);

        await ctx.reply(
          `✅ *${bookTitle}* adicionado com sucesso!\n\n` +
            `📖 Agora está na lista.\n\n` +
            `_Use \`/listas\` para gerenciar._`,
        );

        return { end: true };
      } catch (err) {
        logger.error(`[AddBookFlow] selectList:`, err.message);

        let errorMsg = `❌ Erro ao adicionar livro: ${err.message}`;
        if (
          err.message.includes("already in list") ||
          err.message.includes("already")
        ) {
          errorMsg = `⚠️ *Este livro já está nesta lista!*`;
        } else if (err.message.includes("not found")) {
          errorMsg = `❌ *Lista não encontrada* ou foi deletada.`;
        } else if (err.message.includes("Unauthorized")) {
          errorMsg = `❌ *Sem permissão* para adicionar a essa lista.`;
        } else if (err.message.includes("only accepts")) {
          errorMsg = err.message;
        }

        await ctx.reply(errorMsg);
        return { end: true };
      }
    },
  },
});

module.exports = addBookFlow;
