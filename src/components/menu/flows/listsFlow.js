/**
 * components/menu/flows/listsFlow.js — Flow interativo para gerenciar listas
 * Menu: Ver listas → Selecionar lista → Ver items → Marcar assistido/Rating
 *       Buscar filme → Adicionar à lista
 *       Criar nova lista
 */

const { createFlow } = require("../flowBuilder");
const listClient = require("../../../services/listClient");
const conversationState = require("../../../services/conversationState");
const {
  downloadAndConvertToWebp,
  sendBufferAsSticker,
} = require("../../../utils/stickerHelper");

/**
 * Format título + year para exibição
 */
function formatMovieTitle(movie) {
  const year = movie.year ? ` (${movie.year})` : "";
  return `${movie.title}${year}`;
}

/**
 * Format rating para exibição (⭐ x/5)
 */
function formatRating(rating) {
  if (!rating || rating === null) return "Sem nota";
  const stars = "⭐".repeat(rating);
  return `${stars} ${rating}/5`;
}

const listsFlow = createFlow("lists", {
  root: {
    title: "📽️ Minhas Listas",
    dynamic: true,
    handler: async (ctx) => {
      try {
        // Get lists for user or group (if in group, use groupChat ID)
        const chatId = ctx.chatId || ctx.from;
        const isGroup = chatId && String(chatId).endsWith("@g.us");
        const groupChatId = isGroup ? chatId : null;

        console.log(
          `[ListsFlow] Loading lists - userId=${ctx.userId}, chatId=${chatId}, isGroup=${isGroup}, groupChatId=${groupChatId}`,
        );

        const lists = await listClient.getUserLists(ctx.userId, 1, groupChatId);

        // Log detailed info about each list
        console.log(`[ListsFlow📊] Listas carregadas: ${lists.length}`);
        lists.forEach((list, idx) => {
          const ownerInfo = list.owner
            ? `${list.owner.push_name}`
            : "Desconhecido";
          const visibility = list.isPublic ? "🔓 Pública" : "🔒 Privada";
          console.log(
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

          console.log(`📋 Listas de usuários do grupo:\n${groupSummary}`);
        }

        console.log(
          `[ListsFlow] Loaded ${lists.length} lists for ${isGroup ? "group" : "user"}: ${lists.map((l) => l.title).join(", ")}`,
        );

        if (lists.length === 0) {
          return {
            title: isGroup
              ? "📽️ Nenhuma lista no grupo ainda!\n\n Use `/criar-lista nome` para criar sua primeira lista."
              : "📽️ Você ainda não tem listas!\n\n Use `/criar-lista nome` para criar sua primeira lista.",
            options: [
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

        const options = lists.map((list) => ({
          label:
            `📋 ${list.title} (${list._count.items} items)` +
            (isGroup && list.owner ? ` - ${list.owner.push_name}` : ""),
          action: "exec",
          handler: "selectList",
          data: { listId: list.id, listTitle: list.title },
        }));

        options.push({ label: "🔙 Voltar", action: "back" });

        return {
          title: isGroup ? "📽️ Listas do Grupo" : "📽️ Minhas Listas",
          options,
          skipPoll: false,
        };
      } catch (err) {
        console.error("[ListsFlow] Root error:", err.message);
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

        const userId =
          ctx.state?.context?._backendUserId || ctx.userId;
        const list = await listClient.getList(listId, userId);
        const stats = await listClient.getListStats(listId);

        const itemsText = list.items
          .slice(0, 5)
          .map((item, i) => {
            const watched = item.watched ? "✅" : "❌";
            const rating = item.rating ? ` ${formatRating(item.rating)}` : "";
            return `${i + 1}. ${watched} ${formatMovieTitle(item)}${rating}`;
          })
          .join("\n");

        const title =
          `📋 *${list.title}*\n\n` +
          `📊 Stats:\n` +
          `- Total: ${stats.total} items\n` +
          `- Assistidos: ${stats.watched}/${stats.total}\n` +
          `- Nota média: ${stats.avgRating > 0 ? formatRating(Math.round(stats.avgRating)) : "Sem avaliações"}\n\n` +
          (itemsText
            ? `🎬 Últimos items:\n${itemsText}\n\n`
            : "Nenhum item na lista\n\n");

        const options = [
          {
            label: "📽️ Ver todos os items",
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
        console.error("[ListsFlow] List detail error:", err.message);
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

        const userId =
          ctx.state?.context?._backendUserId || ctx.userId;
        const list = await listClient.getList(listId, userId, 1);

        if (list.items.length === 0) {
          return {
            title: `📽️ ${list.title}\n\nNenhum item na lista ainda.`,
            options: [
              { label: "✄️ Adicionar filme", action: "back" },
              { label: "🔙 Voltar", action: "back" },
            ],
          };
        }

        const options = list.items.map((item, idx) => ({
          label:
            `${idx + 1}. ${formatMovieTitle(item)}` +
            (item.watched ? " ✅" : "") +
            (item.rating ? ` ${formatRating(item.rating)}` : ""),
          action: "exec",
          handler: "selectItem",
          data: { itemId: item.id, item },
        }));

        options.push({ label: "🔙 Voltar", action: "back" });

        return {
          title: `📋 ${list.title} (${list.items.length} items)`,
          options,
        };
      } catch (err) {
        console.error("[ListsFlow] List items error:", err.message);
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

      const title =
        `🎬 ${formatMovieTitle(item)}\n\n` +
        `Status: ${item.watched ? "✅ Assistido" : "❌ Não assistido"}\n` +
        (item.rating ? `Nota: ${formatRating(item.rating)}\n` : "") +
        (item.overview ? `\n📝 ${item.overview.slice(0, 100)}...` : "");

      return {
        title,
        options: [
          {
            label: item.watched
              ? "↩️ Marcar como não assistido"
              : "✅ Marcar como assistido",
            action: "exec",
            handler: "toggleWatched",
          },
          {
            label: "⭐ Adicionar nota",
            action: "exec",
            handler: "rateItem",
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

        const userId =
          ctx.state?.context?._backendUserId || ctx.userId;
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
        console.error("[ListsFlow] Delete confirm error:", err.message);
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
        console.error("[ListsFlow] retryRoot error:", err.message);
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
        console.error("[ListsFlow] retryListDetail error:", err.message);
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
        const { listId, listTitle } = ctx.data || {};

        console.info(
          `[ListsFlow👆] Handler selectList chamado para userId=${ctx.userId}`,
        );
        console.debug(`[ListsFlow👆] ctx.data:`, JSON.stringify(ctx.data));

        if (!listId) {
          console.error(
            `[ListsFlow❌] listId faltando! ctx.data: ${JSON.stringify(
              ctx.data,
            )}`,
          );
          await ctx.reply("❌ Erro ao selecionar lista (dados incompletos)");
          return { end: false };
        }

        console.info(
          `[ListsFlow✅] Lista selecionada: ${listTitle} (${listId})`,
        );

        // Ensure state exists (may be null from processor)
        if (!ctx.state) {
          ctx.state = { path: "/", history: [], context: {} };
          console.debug(`[ListsFlow📝] State inicializado`);
        }
        if (!ctx.state.context) {
          ctx.state.context = {};
        }

        ctx.selectedList = { listId, listTitle };
        // Persist selectedList into context, which is what storage persists
        ctx.state.context.selectedList = ctx.selectedList;
        ctx.state.context.selectedItem = null;
        // Backend list APIs (getList, etc.) require UUID; processor passes resolved ctx.userId
        if (ctx.userId && !String(ctx.userId).includes("@")) {
          ctx.state.context._backendUserId = ctx.userId;
        }
        ctx.state.path = "/list-detail";
        console.debug(`[ListsFlow📝] Navegando para: /list-detail`);
        if (!ctx.state.history.includes("/")) {
          ctx.state.history.push("/");
        }

        return { end: false };
      } catch (err) {
        console.error("[ListsFlow] selectList error:", err.message);
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

        ctx.state.path = "/list-items";
        if (!ctx.state.history.includes("/list-detail")) {
          ctx.state.history.push("/list-detail");
        }
        return { end: false };
      } catch (err) {
        console.error("[ListsFlow] listItems error:", err.message);
        await ctx.reply("❌ Erro ao carregar items");
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

        // Best-effort poster sticker send (do not break flow on failure)
        if (item?.posterUrl) {
          try {
            const webpBuffer = await downloadAndConvertToWebp(
              item.posterUrl,
              itemId,
            );
            if (webpBuffer) {
              await sendBufferAsSticker(ctx.client, ctx.chatId, webpBuffer);
            }
          } catch (stickerErr) {
            console.warn(
              "[ListsFlow] Failed to send poster sticker:",
              stickerErr.message,
            );
          }
        }

        return { end: false };
      } catch (err) {
        console.error("[ListsFlow] selectItem error:", err.message);
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

        await listClient.markWatched(itemId, ctx.userId, newWatchedStatus);

        // Atualizar item local
        if (item) {
          item.watched = newWatchedStatus;
        }

        const msg = newWatchedStatus
          ? "✅ Marcado como assistido"
          : "↩️ Marcado como NÃO assistido";

        await ctx.reply(msg);

        // Volta pro detalhe do item
        if (ctx.state?.context?.selectedItem?.item) {
          ctx.state.context.selectedItem.item.watched = newWatchedStatus;
        }
        if (ctx.state) {
          ctx.state.path = "/item-detail";
        }
        return { end: false };
      } catch (err) {
        console.error("[ListsFlow] Toggle watched error:", err.message);
        await ctx.reply("❌ Erro ao atualizar status");
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
        console.error("[ListsFlow] Remove item error:", err.message);
        await ctx.reply("❌ Erro ao remover item");
        return { end: false };
      }
    },

    /**
     * Adicionar/Atualizar nota (rating) de um item
     */
    rateItem: async (ctx) => {
      try {
        const selectedItem =
          ctx.selectedItem || ctx.state?.context?.selectedItem;
        if (!selectedItem?.itemId) {
          await ctx.reply("❌ Erro: Item não selecionado");
          return { end: false };
        }

        const itemId = selectedItem.itemId;
        const item = selectedItem.item;

        if (!ctx.state) {
          ctx.state = { path: "/", history: [], context: {} };
        }
        if (!ctx.state.context) {
          ctx.state.context = {};
        }

        // Get selected rating from poll option (passed via context)
        let rating = ctx.data?.rating;

        // If no rating in context, ask user via quick reply
        if (!rating && ctx.data?.option) {
          // Extract rating from option label (e.g., "⭐⭐⭐ 3/5")
          const optionLabel = ctx.data.option.label || "";
          const ratingMatch = optionLabel.match(/(\d+)\/5/);
          rating = ratingMatch ? parseInt(ratingMatch[1]) : null;
        }

        // If still no rating, show rating menu
        if (!rating && rating !== 0) {
          await ctx.reply(
            "⭐ Qual é sua nota para este filme?\n\n" +
              "1️⃣ um\n" +
              "2️⃣ dois\n" +
              "3️⃣ três\n" +
              "4️⃣ quatro\n" +
              "5️⃣ cinco\n" +
              "0️⃣ sem nota",
          );
          ctx.state.context.awaitingRating = {
            itemId,
            promptAt: new Date().toISOString(),
          };
          return { end: false, noRender: true };
        }

        // Rating is provided, update it
        await listClient.addRating(itemId, ctx.userId, rating);

        // Update local item
        if (item) {
          item.rating = rating;
        }

        const msg =
          rating > 0
            ? `⭐ Nota atualizada para ${rating}/5`
            : "⭐ Nota removida";

        await ctx.reply(msg);

        // Stay on item-detail
        if (ctx.state?.context?.selectedItem?.item) {
          ctx.state.context.selectedItem.item.rating = rating;
        }
        ctx.state.context.awaitingRating = null;
        if (ctx.state) {
          ctx.state.path = "/item-detail";
        }
        return { end: false };
      } catch (err) {
        console.error("[ListsFlow] Rate item error:", err.message);
        await ctx.reply("❌ Erro ao adicionar nota");
        return { end: false };
      }
    },

    /**
     * Criar nova lista - instrui o usuário a usar comando
     */
    createList: async (ctx) => {
      try {
        // Start interactive list-creation flow and wait for user text input.
        conversationState.startFlow(ctx.userId, "list-creation", {
          chatId: ctx.chatId,
          isGroup: String(ctx.chatId || "").endsWith("@g.us"),
          source: "lists-menu",
        });
        conversationState.nextStep(ctx.userId); // move to step that consumes list name

        await ctx.reply("Qual o nome que deseja dar para a sua nova lista?");
        return { end: true };
      } catch (err) {
        console.error("[ListsFlow] createList error:", err.message);
        await ctx.reply("❌ Erro ao processar comando");
        return { end: true };
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
        console.error("[ListsFlow] deleteList error:", err.message);
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
        console.error("[ListsFlow] confirmDeleteList error:", err.message);
        await ctx.reply(`❌ Erro ao deletar lista: ${err.message}`);
        return { end: false };
      }
    },
  },
});

module.exports = listsFlow;
