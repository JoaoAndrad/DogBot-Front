/**
 * components/menu/flows/listsFlow.js — Flow interativo para gerenciar listas
 * Menu: Ver listas → Selecionar lista → Ver items → Marcar assistido/Rating
 *       Buscar filme → Adicionar à lista
 *       Criar nova lista
 */

const { createFlow } = require("../flowBuilder");
const flowManager = require("../flowManager");
const listClient = require("../../../services/listClient");
const movieClient = require("../../../services/movieClient");
const conversationState = require("../../../services/conversationState");
const {
  downloadImageToBuffer,
  sendBufferAsSticker,
} = require("../../../utils/media/stickerHelper");
const logger = require("../../../utils/logger");

const RATING_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/**
 * Paginação de items em /list-items: 9 items por página de API encaixa com
 * ◀ Voltar + 9 items + Próxima + 🔙 Voltar = 12 opções.
 */
const LIST_ITEMS_PAGE_SIZE = 9;

/**
 * Format título + year para exibição
 */
function formatMovieTitle(movie) {
  const year = movie.year ? ` (${movie.year})` : "";
  return `${movie.title}${year}`;
}

/** Após marcar assistido ou avaliar na lista: mesma enquete de data do /filme */
async function maybeStartFilmCardViewingDatePrompt(
  ctx,
  item,
  userId,
  flowViewingLogIds = [],
) {
  if (!item?.tmdbId) return;
  try {
    const movieInfo = await movieClient.getMovieInfoWithAllRatings(
      String(item.tmdbId),
      userId,
    );
    const initialContext = {
      movieInfo,
      tmdbId: String(item.tmdbId),
      filmTitle: formatMovieTitle(item),
    };
    if (Array.isArray(flowViewingLogIds) && flowViewingLogIds.length > 0) {
      initialContext.flowViewingLogIds = [...flowViewingLogIds];
    }
    await flowManager.startFlow(ctx.client, ctx.chatId, userId, "film-card", {
      initialPath: "/after-watch-prompt",
      initialContext,
    });
  } catch (e) {
    logger.warn("[ListsFlow] film-card viewing date prompt:", e.message);
  }
}

/**
 * Format rating para exibição (⭐ x/5)
 */
function formatRating(rating) {
  if (!rating || rating === null) return "Sem nota";
  const stars = "⭐".repeat(rating);
  return `${stars} ${rating}/5`;
}

function listKindIcon(kind) {
  return (kind || "movie") === "book" ? "📖" : "📽️";
}

const listsFlow = createFlow("lists", {
  root: {
    title: "📋 Minhas listas (filmes e livros)",
    dynamic: true,
    handler: async (ctx) => {
      try {
        // Get lists for user or group (if in group, use groupChat ID)
        const chatId = ctx.chatId || ctx.from;
        const isGroup = chatId && String(chatId).endsWith("@g.us");
        const groupChatId = isGroup ? chatId : null;

        logger.debug(
          `[ListsFlow] Loading lists - userId=${ctx.userId}, chatId=${chatId}, isGroup=${isGroup}, groupChatId=${groupChatId}`,
        );

        const lists = await listClient.getUserLists(ctx.userId, 1, groupChatId);

        // Log detailed info about each list
        logger.debug(`[ListsFlow📊] Listas carregadas: ${lists.length}`);
        lists.forEach((list, idx) => {
          const ownerInfo = list.owner
            ? `${list.owner.push_name}`
            : "Desconhecido";
          const visibility = list.isPublic ? "🔓 Pública" : "🔒 Privada";
          logger.debug(
            `[ListsFlow📋] Lista ${idx + 1}: "${list.title}" | ID: ${list.id} | Items: ${list._count.items} | Owner: ${ownerInfo} | ${visibility}`,
          );
        });

        // Format logging for group lists
        if (isGroup && lists.length > 0) {
          // Group lists by owner
          const listsByOwner = {};
          lists.forEach((list) => {
            const ownerName =
              list.owner?.push_name || list.ownerUserId || "Desconhecido";
            if (!listsByOwner[ownerName]) {
              listsByOwner[ownerName] = [];
            }
            listsByOwner[ownerName].push(list);
          });

          // Format nice log
          const groupSummary = Object.entries(listsByOwner)
            .map(([owner, ownerLists]) => {
              const listTitles = ownerLists
                .map((l) => `"${l.title}" (${l._count.items} items)`)
                .join(", ");
              return `  👤 ${owner}: ${listTitles}`;
            })
            .join("\n");

          logger.debug(`📋 Listas de usuários do grupo:\n${groupSummary}`);
        }

        logger.debug(
          `[ListsFlow] Loaded ${lists.length} lists for ${isGroup ? "group" : "user"}: ${lists.map((l) => l.title).join(", ")}`,
        );

        if (lists.length === 0) {
          return {
            title: isGroup
              ? "📋 Nenhuma lista no grupo ainda!\n\n Toque em *Criar nova lista*. O bot vai perguntar se é lista de *filmes* ou *livros*, depois o nome."
              : "📋 Você ainda não tem listas!\n\n Toque em *Criar nova lista*. O bot pergunta se é *filmes* ou *livros*, depois o nome da lista.",
            options: [
              {
                label: "📊 Resumo de filmes (período)",
                action: "exec",
                handler: "openMovieStats",
              },
              {
                label: "📚 Resumo de livros (período)",
                action: "exec",
                handler: "openBookStats",
              },
              {
                label: "➕ Criar nova lista",
                action: "exec",
                handler: "createList",
              },
              { label: "🔙 Voltar", action: "back" },
            ],
            skipPoll: false,
          };
        }

        const options = [
          {
            label: "📊 Resumo de filmes (período)",
            action: "exec",
            handler: "openMovieStats",
          },
          {
            label: "📚 Resumo de livros (período)",
            action: "exec",
            handler: "openBookStats",
          },
          {
            label: "➕ Criar nova lista",
            action: "exec",
            handler: "createList",
          },
          ...lists.map((list) => ({
            label:
              `${listKindIcon(list.listKind)} ${list.title} (${list._count.items} items)` +
              (isGroup && list.owner ? ` - ${list.owner.push_name}` : ""),
            action: "exec",
            handler: "selectList",
            data: {
              listId: list.id,
              listTitle: list.title,
              listKind: list.listKind || "movie",
            },
          })),
        ];

        options.push({ label: "🔙 Voltar", action: "back" });

        return {
          title: isGroup
            ? "📋 Listas do grupo (filmes e livros)"
            : "📋 Minhas listas (filmes e livros)",
          options,
          skipPoll: false,
        };
      } catch (err) {
        logger.error("[ListsFlow] Root error:", err.message);
        return {
          title:
            "❌ Erro ao carregar listas.\n\n" + "Tente novamente ou volte.",
          options: [
            {
              label: "🔄 Tentar novamente",
              action: "exec",
              handler: "retryRoot",
            },
            { label: "🔙 Voltar", action: "back" },
          ],
          skipPoll: false,
        };
      }
    },
  },

  "/create-list-kind": {
    title: "📋 Nova lista\n\nÉ para filmes ou livros?",
    options: [
      {
        label: "📽️ Filmes",
        action: "exec",
        handler: "createListPickMovie",
      },
      {
        label: "📖 Livros",
        action: "exec",
        handler: "createListPickBook",
      },
      { label: "🔙 Voltar", action: "back" },
    ],
  },

  "/create-list-confirm": {
    title: "📋 Confirmar lista",
    dynamic: true,
    handler: async (ctx) => {
      const c = ctx.state?.context?.createListConfirm;
      if (!c?.listName || !c?.listKind) {
        return {
          title:
            "❌ Dados em falta. Abra */listas* e use *Criar nova lista* de novo.",
          skipPoll: true,
        };
      }
      const kindLabel = c.listKind === "book" ? "livros" : "filmes";
      const namePlain = String(c.listName).replace(/[*_`]/g, "");
      return {
        title:
          `📋 *Confirmar criação*\n\n` +
          `Tipo: *${kindLabel}*\n` +
          `Nome: ${namePlain}\n\n` +
          `O que deseja fazer?`,
        options: [
          {
            label: "Confirmar",
            action: "exec",
            handler: "confirmCreateListDraft",
          },
          {
            label: "Enviar novo nome",
            action: "exec",
            handler: "retryCreateListName",
          },
          {
            label: "Cancelar criação de lista",
            action: "exec",
            handler: "cancelCreateListDraft",
          },
        ],
      };
    },
  },

  "/list-detail": {
    title: "📋 Detalhes da Lista",
    dynamic: true,
    handler: async (ctx) => {
      try {
        const { listId } =
          ctx.selectedList || ctx.state?.context?.selectedList || {};
        if (!listId) {
          return {
            title: "❌ Erro: Lista não selecionada",
            options: [
              {
                label: "🔄 Tentar novamente",
                action: "exec",
                handler: "retryListDetail",
              },
              { label: "🔙 Voltar", action: "back" },
            ],
          };
        }

        const userId = ctx.state?.context?._backendUserId || ctx.userId;
        const list = await listClient.getList(listId, userId);
        const stats = await listClient.getListStats(listId);
        const kind = list.listKind || "movie";
        const doneLabel = kind === "book" ? "Lidos" : "Assistidos";

        const itemsText = list.items
          .slice(0, 5)
          .map((item, i) => {
            const watched = item.watched ? "✅" : "❌";
            const rating = item.rating ? ` ${formatRating(item.rating)}` : "";
            return `${i + 1}. ${watched} ${formatMovieTitle(item)}${rating}`;
          })
          .join("\n");

        const title =
          `${listKindIcon(kind)} *${list.title}*\n\n` +
          `📊 Stats:\n` +
          `- Total: ${stats.total} items\n` +
          `- ${doneLabel}: ${stats.watched}/${stats.total}\n` +
          `- Nota média: ${stats.avgRating > 0 ? formatRating(Math.round(stats.avgRating)) : "Sem avaliações"}\n\n` +
          (itemsText
            ? `${listKindIcon(kind)} Últimos items:\n${itemsText}\n\n`
            : "Nenhum item na lista\n\n");

        const options = [
          {
            label: `${listKindIcon(kind)} Ver todos os items`,
            action: "exec",
            handler: "listItems",
          },
          {
            label: "🗑️ Deletar lista",
            action: "exec",
            handler: "deleteList",
          },
          { label: "🔙 Voltar", action: "back" },
        ];

        return { title, options, skipPoll: false };
      } catch (err) {
        logger.error("[ListsFlow] List detail error:", err.message);
        return {
          title: "❌ Erro ao carregar lista",
          options: [
            {
              label: "🔄 Tentar novamente",
              action: "exec",
              handler: "retryListDetail",
            },
            { label: "🔙 Voltar", action: "back" },
          ],
        };
      }
    },
  },

  "/list-items": {
    title: "🎬 Items da Lista",
    dynamic: true,
    handler: async (ctx) => {
      try {
        const { listId } =
          ctx.selectedList || ctx.state?.context?.selectedList || {};
        if (!listId) {
          return {
            title: "❌ Erro: Lista não selecionada",
            options: [
              {
                label: "🔄 Tentar novamente",
                action: "exec",
                handler: "retryListDetail",
              },
              { label: "🔙 Voltar", action: "back" },
            ],
          };
        }

        const userId = ctx.state?.context?._backendUserId || ctx.userId;
        const listItemsPage = Math.max(
          1,
          Number(ctx.state?.context?.listItemsPage) || 1,
        );
        const list = await listClient.getList(
          listId,
          userId,
          listItemsPage,
          LIST_ITEMS_PAGE_SIZE,
        );
        const kind = list.listKind || "movie";
        const addHint =
          kind === "book"
            ? "Use /livro para buscar e adicionar."
            : "Use /filme para buscar e adicionar.";

        let totalItems = list._count?.items ?? 0;
        const pageSize = LIST_ITEMS_PAGE_SIZE;
        let listItemsPageAdj = listItemsPage;
        let items = list.items || [];
        if (items.length === 0 && totalItems > 0) {
          const lastPage = Math.max(1, Math.ceil(totalItems / pageSize));
          listItemsPageAdj = Math.min(listItemsPage, lastPage);
          if (listItemsPageAdj !== listItemsPage && ctx.state?.context) {
            ctx.state.context.listItemsPage = listItemsPageAdj;
          }
          const listFix = await listClient.getList(
            listId,
            userId,
            listItemsPageAdj,
            LIST_ITEMS_PAGE_SIZE,
          );
          items = listFix.items || [];
          totalItems = listFix._count?.items ?? totalItems;
        }
        const offset = (listItemsPageAdj - 1) * pageSize;
        const hasMore = offset + items.length < totalItems;

        if (totalItems === 0 || (listItemsPageAdj === 1 && items.length === 0)) {
          return {
            title: `${listKindIcon(kind)} ${list.title}\n\nNenhum item na lista ainda.\n\n_${addHint}_`,
            options: [{ label: "🔙 Voltar", action: "back" }],
          };
        }

        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const pageHint =
          totalPages > 1
            ? `\n_Página ${listItemsPageAdj}/${totalPages} · ${totalItems} no total_`
            : `\n_${totalItems} no total_`;

        const options = [];
        if (listItemsPageAdj > 1) {
          options.push({
            label: "⬅️ Anterior",
            action: "exec",
            handler: "listItemsPrevPage",
          });
        }

        items.forEach((item, idx) => {
          const globalIdx = offset + idx + 1;
          options.push({
            label:
              `${globalIdx}. ${formatMovieTitle(item)}` +
              (item.watched ? " ✅" : "") +
              (item.rating ? ` ${formatRating(item.rating)}` : ""),
            action: "exec",
            handler: "selectItem",
            data: { itemId: item.id, item },
          });
        });

        if (hasMore) {
          options.push({
            label: "➡️ Próxima",
            action: "exec",
            handler: "listItemsNextPage",
          });
        }

        options.push({ label: "🔙 Voltar", action: "back" });

        return {
          title: `${listKindIcon(kind)} ${list.title}${pageHint}`,
          options,
        };
      } catch (err) {
        logger.error("[ListsFlow] List items error:", err.message);
        return {
          title: "❌ Erro ao carregar items",
          options: [
            {
              label: "🔄 Tentar novamente",
              action: "exec",
              handler: "retryListDetail",
            },
            { label: "🔙 Voltar", action: "back" },
          ],
        };
      }
    },
  },

  "/item-detail": {
    title: "🎬 Detalhes do Item",
    dynamic: true,
    handler: async (ctx) => {
      const { item } =
        ctx.selectedItem || ctx.state?.context?.selectedItem || {};
      if (!item) {
        return {
          title: "❌ Erro: Item não selecionado",
          options: [
            {
              label: "🔄 Tentar novamente",
              action: "exec",
              handler: "retryListDetail",
            },
            { label: "🔙 Voltar", action: "back" },
          ],
        };
      }

      const tid = item.tmdbId && String(item.tmdbId).toLowerCase();
      const tmdbLooksBook =
        tid && (tid.startsWith("ol:") || tid.startsWith("gb:"));
      const listKind =
        ctx.state?.context?.selectedList?.listKind ||
        (tmdbLooksBook ? "book" : "movie");
      const isBook = listKind === "book";
      const statusLine = isBook
        ? item.watched
          ? "✅ Lido"
          : "❌ Não lido"
        : item.watched
          ? "✅ Assistido"
          : "❌ Não assistido";
      const toggleSeen = isBook
        ? item.watched
          ? "↩️ Marcar como não lido"
          : "✅ Marcar como lido"
        : item.watched
          ? "↩️ Marcar como não assistido"
          : "✅ Marcar como assistido";

      const title =
        `${isBook ? "📖" : "🎬"} ${formatMovieTitle(item)}\n\n` +
        `Status: ${statusLine}\n` +
        (item.rating ? `Nota: ${formatRating(item.rating)}\n` : "") +
        (item.overview ? `\n📝 ${item.overview.slice(0, 100)}...` : "");

      return {
        title,
        options: [
          {
            label: toggleSeen,
            action: "exec",
            handler: "toggleWatched",
          },
          {
            label: "⭐ Adicionar nota",
            action: "exec",
            handler: "askRatingItem",
          },
          {
            label: "❌ Remover da lista",
            action: "exec",
            handler: "removeItem",
          },
          { label: "🔙 Voltar", action: "back" },
        ],
      };
    },
  },

  "/rating-item": {
    title: "Sua nota (0,5 a 5):",
    options: [
      ...RATING_OPTIONS.map((r) => ({
        label: `${r}⭐`,
        action: "exec",
        handler: "rateItem",
        data: { rating: r },
      })),
      { label: "🔙 Voltar", action: "back" },
    ],
  },

  "/delete-list-confirm": {
    title: "🗑️ Confirmar Deleção",
    dynamic: true,
    handler: async (ctx) => {
      try {
        const { listId, listTitle } =
          ctx.selectedList || ctx.state?.context?.selectedList || {};
        if (!listId) {
          return {
            title: "❌ Erro: Lista não selecionada",
            options: [{ label: "🔙 Voltar", action: "back" }],
          };
        }

        const userId = ctx.state?.context?._backendUserId || ctx.userId;
        const list = await listClient.getList(listId, userId);
        const itemCount = list.items?.length || 0;

        const title =
          `⚠️ *Deletar Lista: ${listTitle}?*\n\n` +
          `Esta ação é irreversível!\n\n` +
          `📊 Items na lista: ${itemCount}\n\n` +
          `Tem certeza que deseja deletar essa lista?`;

        return {
          title,
          options: [
            {
              label: "✅ Sim, deletar",
              action: "exec",
              handler: "confirmDeleteList",
            },
            { label: "❌ Cancelar", action: "back" },
          ],
        };
      } catch (err) {
        logger.error("[ListsFlow] Delete confirm error:", err.message);
        return {
          title: "❌ Erro ao confirmar deleção",
          options: [{ label: "🔙 Voltar", action: "back" }],
        };
      }
    },
  },

  handlers: {
    /**
     * Retry loading root (reediting current node)
     */
    retryRoot: async (ctx) => {
      try {
        // Simply reset path to root and let it re-render
        if (ctx.state) {
          ctx.state.path = "/";
        }
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] retryRoot error:", err.message);
        await ctx.reply("❌ Erro ao tentar novamente");
        return { end: false };
      }
    },

    /**
     * Retry loading list detail (re-render current node)
     */
    retryListDetail: async (ctx) => {
      try {
        // Path stays in /list-detail, which will re-render the node
        // and attempt to load the list data again
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] retryListDetail error:", err.message);
        await ctx.reply("❌ Erro ao tentar novamente");
        return { end: false };
      }
    },

    /**
     * Selecionar uma lista para visualizar
     */
    selectList: async (ctx) => {
      try {
        // Data comes from ctx.data (backend response) with poll option data
        const { listId, listTitle, listKind } = ctx.data || {};

        logger.info(
          `[ListsFlow👆] Handler selectList chamado para userId=${ctx.userId}`,
        );
        logger.debug(`[ListsFlow👆] ctx.data:`, JSON.stringify(ctx.data));

        if (!listId) {
          logger.error(
            `[ListsFlow❌] listId faltando! ctx.data: ${JSON.stringify(
              ctx.data,
            )}`,
          );
          await ctx.reply("❌ Erro ao selecionar lista (dados incompletos)");
          return { end: false };
        }

        logger.info(
          `[ListsFlow✅] Lista selecionada: ${listTitle} (${listId})`,
        );

        // Ensure state exists (may be null from processor)
        if (!ctx.state) {
          ctx.state = { path: "/", history: [], context: {} };
          logger.debug(`[ListsFlow📝] State inicializado`);
        }
        if (!ctx.state.context) {
          ctx.state.context = {};
        }

        ctx.selectedList = {
          listId,
          listTitle,
          listKind: listKind || "movie",
        };
        // Persist selectedList into context, which is what storage persists
        ctx.state.context.selectedList = ctx.selectedList;
        ctx.state.context.selectedItem = null;
        // Backend list APIs (getList, etc.) require UUID; processor passes resolved ctx.userId
        if (ctx.userId && !String(ctx.userId).includes("@")) {
          ctx.state.context._backendUserId = ctx.userId;
        }
        ctx.state.path = "/list-detail";
        logger.debug(`[ListsFlow📝] Navegando para: /list-detail`);
        if (!ctx.state.history.includes("/")) {
          ctx.state.history.push("/");
        }

        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] selectList error:", err.message);
        await ctx.reply("❌ Erro ao selecionar lista");
        return { end: false };
      }
    },

    /**
     * Ver items de uma lista
     */
    listItems: async (ctx) => {
      try {
        if (!ctx.state) {
          ctx.state = { path: "/", history: [], context: {} };
        }
        if (!ctx.state.context) {
          ctx.state.context = {};
        }
        ctx.state.context.listItemsPage = 1;

        ctx.state.path = "/list-items";
        if (!ctx.state.history.includes("/list-detail")) {
          ctx.state.history.push("/list-detail");
        }
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] listItems error:", err.message);
        await ctx.reply("❌ Erro ao carregar items");
        return { end: false };
      }
    },

    /** Próxima página de items (enquete) */
    listItemsNextPage: async (ctx) => {
      try {
        if (!ctx.state) {
          ctx.state = { path: "/list-items", history: [], context: {} };
        }
        if (!ctx.state.context) {
          ctx.state.context = {};
        }
        const cur = Math.max(1, Number(ctx.state.context.listItemsPage) || 1);
        ctx.state.context.listItemsPage = cur + 1;
        ctx.state.path = "/list-items";
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] listItemsNextPage:", err.message);
        return { end: false };
      }
    },

    /** Página anterior de items (enquete) */
    listItemsPrevPage: async (ctx) => {
      try {
        if (!ctx.state) {
          ctx.state = { path: "/list-items", history: [], context: {} };
        }
        if (!ctx.state.context) {
          ctx.state.context = {};
        }
        const cur = Math.max(1, Number(ctx.state.context.listItemsPage) || 1);
        ctx.state.context.listItemsPage = Math.max(1, cur - 1);
        ctx.state.path = "/list-items";
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] listItemsPrevPage:", err.message);
        return { end: false };
      }
    },

    /**
     * Selecionar um item para detalhes
     */
    selectItem: async (ctx) => {
      try {
        const { itemId, item } = ctx.data || {};
        if (!itemId) {
          await ctx.reply("❌ Erro ao selecionar item");
          return { end: false };
        }

        if (!ctx.state) {
          ctx.state = { path: "/", history: [], context: {} };
        }

        if (!ctx.state.context) {
          ctx.state.context = {};
        }

        ctx.selectedItem = { itemId, item };
        ctx.state.context.selectedItem = ctx.selectedItem;
        if (!ctx.state.history.includes("/list-items")) {
          ctx.state.history.push("/list-items");
        }
        ctx.state.path = "/item-detail";

        // Best-effort poster sticker (fullOnly, sem redimensionar — alinhado ao filmCard)
        if (item?.posterUrl) {
          try {
            const posterBuffer = await downloadImageToBuffer(item.posterUrl);
            if (posterBuffer) {
              await sendBufferAsSticker(ctx.client, ctx.chatId, posterBuffer, {
                fullOnly: true,
              });
            }
          } catch (stickerErr) {
            logger.warn(
              "[ListsFlow] Failed to send poster sticker:",
              stickerErr.message,
            );
          }
        }

        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] selectItem error:", err.message);
        await ctx.reply("❌ Erro ao selecionar item");
        return { end: false };
      }
    },

    /**
     * Toggle assistido/não assistido
     */
    toggleWatched: async (ctx) => {
      try {
        const selectedItem =
          ctx.selectedItem || ctx.state?.context?.selectedItem;
        if (!selectedItem?.itemId) {
          await ctx.reply("❌ Erro: Item não selecionado");
          return { end: false };
        }

        const itemId = selectedItem.itemId;
        const item = selectedItem.item;
        const isCurrentlyWatched = item?.watched || false;
        const newWatchedStatus = !isCurrentlyWatched;

        const userId = ctx.state?.context?._backendUserId || ctx.userId;
        await listClient.markWatched(itemId, userId, newWatchedStatus);

        // Assistido na lista é independente do /filme (MovieRating). Só sincronizamos
        // para o geral quando o usuário marca assistido aqui — não o contrário.
        let flowViewingLogIds = [];
        if (item?.tmdbId && newWatchedStatus) {
          try {
            const mw = await movieClient.markWatched(userId, item.tmdbId, {
              title: item.title,
              year: item.year,
              posterUrl: item.posterUrl,
            });
            if (mw?.viewingLogId) flowViewingLogIds.push(mw.viewingLogId);
          } catch (e) {
            logger.warn(
              "[ListsFlow] Sync to MovieRating after markWatched failed:",
              e.message,
            );
          }
        }

        // Atualizar item local
        if (item) {
          item.watched = newWatchedStatus;
        }

        const titleStr = item ? formatMovieTitle(item) : "Item";
        const msg = newWatchedStatus
          ? `✅ *${titleStr}*\n\nMarcado como assistido! 🎬`
          : `↩️ *${titleStr}*\n\nMarcado como NÃO assistido`;

        await ctx.reply(msg);

        if (item?.tmdbId && newWatchedStatus) {
          await maybeStartFilmCardViewingDatePrompt(
            ctx,
            item,
            userId,
            flowViewingLogIds,
          );
        }

        // Volta pro detalhe do item
        if (ctx.state?.context?.selectedItem?.item) {
          ctx.state.context.selectedItem.item.watched = newWatchedStatus;
        }
        if (ctx.state) {
          ctx.state.path = "/item-detail";
        }
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] Toggle watched error:", err.message);
        await ctx.reply("❌ Erro ao atualizar status");
        return { end: false };
      }
    },

    /**
     * Navegar para o nó de avaliação (enquete 0,5 a 5), alinhado ao filmCard
     */
    askRatingItem: async (ctx) => {
      try {
        if (!ctx.state) {
          ctx.state = { path: "/", history: [], context: {} };
        }
        if (!ctx.state.history) {
          ctx.state.history = [];
        }
        if (!ctx.state.history.includes("/item-detail")) {
          ctx.state.history.push("/item-detail");
        }
        ctx.state.path = "/rating-item";
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] askRatingItem error:", err.message);
        await ctx.reply("❌ Erro ao abrir avaliação");
        return { end: false };
      }
    },

    /**
     * Remover item da lista
     */
    removeItem: async (ctx) => {
      try {
        const selectedItem =
          ctx.selectedItem || ctx.state?.context?.selectedItem;
        if (!selectedItem?.itemId) {
          await ctx.reply("❌ Erro: Item não selecionado");
          return { end: false };
        }

        const itemId = selectedItem.itemId;
        await listClient.removeItem(itemId, ctx.userId);
        await ctx.reply("✅ Item removido da lista!");

        // Volta pra lista de items
        if (ctx.state) {
          if (!ctx.state.context) {
            ctx.state.context = {};
          }
          ctx.state.context.selectedItem = null;
          ctx.state.path = "/list-items";
        }
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] Remove item error:", err.message);
        await ctx.reply("❌ Erro ao remover item");
        return { end: false };
      }
    },

    /**
     * Aplicar nota escolhida na enquete (0,5 a 5). Alinhado ao filmCard: marca como assistido ao avaliar, mensagem + sticker fullOnly.
     */
    rateItem: async (ctx) => {
      try {
        const rating = ctx.data?.rating;
        const selectedItem =
          ctx.selectedItem || ctx.state?.context?.selectedItem;
        if (!selectedItem?.itemId) {
          await ctx.reply("❌ Erro: Item não selecionado");
          return { end: false };
        }

        const itemId = selectedItem.itemId;
        const item = selectedItem.item;

        if (rating == null || rating === undefined) {
          await ctx.reply("❌ Erro: nota não encontrada. Tente novamente.");
          ctx.state.path = "/item-detail";
          return { end: false };
        }

        const numRating = Number(rating);
        if (Number.isNaN(numRating) || numRating < 0.5 || numRating > 5) {
          await ctx.reply("❌ Nota inválida. Use um valor entre 0,5 e 5.");
          ctx.state.path = "/item-detail";
          return { end: false };
        }

        const userId = ctx.state?.context?._backendUserId || ctx.userId;

        // Marcar como assistido ao avaliar (alinhado ao filmCard)
        try {
          await listClient.markWatched(itemId, userId, true);
        } catch (e) {
          logger.warn("[ListsFlow] markWatched before rate:", e.message);
        }

        await listClient.addRating(itemId, userId, numRating);

        if (item) {
          item.rating = numRating;
          item.watched = true;
        }
        if (ctx.state?.context?.selectedItem?.item) {
          ctx.state.context.selectedItem.item.rating = numRating;
          ctx.state.context.selectedItem.item.watched = true;
        }

        // Sincronizar com MovieRating para /filme mostrar a mesma nota (plano alternativo)
        let flowViewingLogIds = [];
        if (item?.tmdbId) {
          try {
            const mw = await movieClient.markWatched(userId, item.tmdbId, {
              title: item.title,
              year: item.year,
              posterUrl: item.posterUrl,
            });
            if (mw?.viewingLogId) flowViewingLogIds.push(mw.viewingLogId);
            const rm = await movieClient.rateMovie(userId, item.tmdbId, numRating, {
              title: item.title,
              year: item.year,
              posterUrl: item.posterUrl,
            });
            if (rm?.viewingLogId) flowViewingLogIds.push(rm.viewingLogId);
          } catch (e) {
            logger.warn(
              "[ListsFlow] Sync to MovieRating after rate failed:",
              e.message,
            );
          }
        }

        const stars = "⭐".repeat(Math.round(numRating));
        const titleStr = formatMovieTitle(item);
        await ctx.reply(
          `⭐ *${titleStr}*\n\n${stars} ${numRating}/5\n\n✅ Avaliação salva com sucesso!`,
        );

        if (item?.posterUrl) {
          try {
            const posterBuffer = await downloadImageToBuffer(item.posterUrl);
            if (posterBuffer) {
              await sendBufferAsSticker(ctx.client, ctx.chatId, posterBuffer, {
                fullOnly: true,
              });
            }
          } catch (e) {
            logger.warn("[ListsFlow] poster sticker after rate:", e.message);
          }
        }

        if (item?.tmdbId) {
          await maybeStartFilmCardViewingDatePrompt(
            ctx,
            item,
            userId,
            flowViewingLogIds,
          );
        }

        ctx.state.path = "/item-detail";
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] Rate item error:", err.message);
        await ctx.reply("❌ Erro ao adicionar nota");
        ctx.state.path = "/item-detail";
        return { end: false };
      }
    },

    /**
     * Criar nova lista — enquete filmes vs livros
     */
    createList: async (ctx) => {
      try {
        if (!ctx.state) {
          ctx.state = { path: "/", history: [], context: {} };
        }
        ctx.state.history.push(ctx.state.path || "/");
        ctx.state.path = "/create-list-kind";
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] createList error:", err.message);
        await ctx.reply("❌ Erro ao processar comando");
        return { end: true };
      }
    },

    createListPickMovie: async (ctx) => {
      try {
        const isGroup = String(ctx.chatId || "").endsWith("@g.us");
        conversationState.startFlow(ctx.userId, "list-creation", {
          chatId: ctx.chatId,
          isGroup,
          source: "lists-menu",
        });
        conversationState.updateData(ctx.userId, { listKind: "movie" });
        conversationState.setStep(ctx.userId, 1);
        await ctx.reply(
          "✅ Lista de *filmes*.\n\n" +
            "Digite o *nome* da lista (máx. 50 caracteres):\n\n" +
            "_Ex.: Clássicos, Para assistir no fim de semana_",
        );
        return { end: true };
      } catch (err) {
        logger.error("[ListsFlow] createListPickMovie error:", err.message);
        await ctx.reply("❌ Erro ao processar");
        return { end: true };
      }
    },

    createListPickBook: async (ctx) => {
      try {
        const isGroup = String(ctx.chatId || "").endsWith("@g.us");
        conversationState.startFlow(ctx.userId, "list-creation", {
          chatId: ctx.chatId,
          isGroup,
          source: "lists-menu",
        });
        conversationState.updateData(ctx.userId, { listKind: "book" });
        conversationState.setStep(ctx.userId, 1);
        await ctx.reply(
          "✅ Lista de *livros*.\n\n" +
            "Digite o *nome* da lista (máx. 50 caracteres):\n\n" +
            "_Ex.: Leituras 2025, Ficção científica_",
        );
        return { end: true };
      } catch (err) {
        logger.error("[ListsFlow] createListPickBook error:", err.message);
        await ctx.reply("❌ Erro ao processar");
        return { end: true };
      }
    },

    confirmCreateListDraft: async (ctx) => {
      const c = ctx.state?.context?.createListConfirm;
      if (!c?.listName || !c?.listKind) {
        await ctx.reply("❌ Sessão inválida. Use */listas* de novo.");
        return { end: true };
      }
      const listKind = c.listKind === "book" ? "book" : "movie";
      const groupChatId = c.isGroup ? c.chatId : null;
      try {
        const newList = await listClient.createList(ctx.userId, {
          title: String(c.listName).trim(),
          groupChatId,
          listKind,
        });
        if (!newList) {
          conversationState.clearState(ctx.userId);
          await ctx.reply(
            "❌ Erro ao criar lista. Tente */listas* → *Criar nova lista*.",
          );
          return { end: true };
        }
        conversationState.clearState(ctx.userId);
        const filmTip =
          listKind === "movie"
            ? "• Use `/filme` para buscar e adicionar filmes\n"
            : "";
        const bookTip =
          listKind === "book"
            ? "• Use `/livro` para buscar e adicionar livros\n"
            : "";
        await ctx.reply(
          `✅ *Lista criada com sucesso!*\n\n` +
            `${listKindIcon(listKind)} ${newList.title}\n\n` +
            `${filmTip}${bookTip}` +
            `• Use \`/listas\` para gerenciar`,
        );
      } catch (err) {
        logger.error("[ListsFlow] confirmCreateListDraft:", err.message);
        conversationState.clearState(ctx.userId);
        await ctx.reply(
          `❌ Erro ao criar lista: ${err.message}\n\n` +
            "Tente */listas* → *Criar nova lista*.",
        );
      }
      return { end: true };
    },

    retryCreateListName: async (ctx) => {
      const c = ctx.state?.context?.createListConfirm;
      if (!c?.listKind || !c.chatId) {
        await ctx.reply("❌ Sessão inválida. Use */listas* de novo.");
        return { end: true };
      }
      const listKind = c.listKind === "book" ? "book" : "movie";
      conversationState.startFlow(ctx.userId, "list-creation", {
        chatId: c.chatId,
        isGroup: !!c.isGroup,
        source: "lists-menu",
      });
      conversationState.updateData(ctx.userId, { listKind });
      conversationState.setStep(ctx.userId, 1);
      const hint =
        listKind === "book"
          ? "_Ex.: Leituras 2025, Ficção científica_"
          : "_Ex.: Clássicos, Para assistir no fim de semana_";
      await ctx.reply(
        `Digite o *nome* desejado para a lista (máx. 50 caracteres):\n\n` +
          hint,
      );
      return { end: true };
    },

    cancelCreateListDraft: async (ctx) => {
      conversationState.clearState(ctx.userId);
      await ctx.reply("❌ Criação da lista cancelada.");
      return { end: true };
    },

    /**
     * Abre o flow de resumo de filmes por período (cartão PNG se houver atividade).
     */
    openMovieStats: async (ctx) => {
      try {
        await flowManager.startFlow(ctx.client, ctx.chatId, ctx.userId, "movies");
        return { end: true };
      } catch (err) {
        logger.error("[ListsFlow] openMovieStats:", err.message);
        await ctx.reply("❌ Não foi possível abrir o resumo de filmes.");
        return { end: false };
      }
    },

    /**
     * Abre o flow de resumo de livros por período (cartão PNG se houver atividade).
     */
    openBookStats: async (ctx) => {
      try {
        await flowManager.startFlow(ctx.client, ctx.chatId, ctx.userId, "books");
        return { end: true };
      } catch (err) {
        logger.error("[ListsFlow] openBookStats:", err.message);
        await ctx.reply("❌ Não foi possível abrir o resumo de livros.");
        return { end: false };
      }
    },

    /**
     * Deletar lista - navega para confirmação
     */
    deleteList: async (ctx) => {
      try {
        const selectedList =
          ctx.selectedList || ctx.state?.context?.selectedList;
        if (!selectedList?.listId) {
          await ctx.reply("❌ Erro: Lista não selecionada");
          return { end: false };
        }

        if (!ctx.state) {
          ctx.state = { path: "/", history: [], context: {} };
        }

        ctx.state.path = "/delete-list-confirm";
        if (!ctx.state.history.includes("/list-detail")) {
          ctx.state.history.push("/list-detail");
        }
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] deleteList error:", err.message);
        await ctx.reply("❌ Erro ao deletar lista");
        return { end: false };
      }
    },

    /**
     * Confirmar deleção de lista
     */
    confirmDeleteList: async (ctx) => {
      try {
        const selectedList =
          ctx.selectedList || ctx.state?.context?.selectedList;
        if (!selectedList?.listId) {
          await ctx.reply("❌ Erro: Lista não selecionada");
          return { end: false };
        }

        const listId = selectedList.listId;
        const listTitle = selectedList.listTitle;

        await listClient.deleteList(listId, ctx.userId);
        await ctx.reply(`✅ Lista "${listTitle}" foi deletada com sucesso!`);

        // Volta pro menu raiz
        if (ctx.state) {
          ctx.state.path = "/";
          ctx.state.history = [];
          if (!ctx.state.context) {
            ctx.state.context = {};
          }
          ctx.state.context.selectedList = null;
          ctx.state.context.selectedItem = null;
        }
        ctx.selectedList = null;
        return { end: false };
      } catch (err) {
        logger.error("[ListsFlow] confirmDeleteList error:", err.message);
        await ctx.reply(`❌ Erro ao deletar lista: ${err.message}`);
        return { end: false };
      }
    },
  },
});

module.exports = listsFlow;
