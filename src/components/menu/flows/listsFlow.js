/**
 * components/menu/flows/listsFlow.js — Flow interativo para gerenciar listas
 * Menu: Ver listas → Selecionar lista → Ver items → Marcar assistido/Rating
 *       Buscar filme → Adicionar à lista
 *       Criar nova lista
 */

const { createFlow } = require("../flowBuilder");
const listClient = require("../../../services/listClient");

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
                .map((l) => `"${l.title}"`)
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
            (isGroup && list.owner ? ` - ${list.owner.pushName}` : ""),
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
            { label: "🔄 Tentar novamente", action: "exec", handler: "root" },
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
        const { listId } = ctx.selectedList || {};
        if (!listId) {
          return {
            title: "❌ Erro: Lista não selecionada",
            options: [
              { label: "🔄 Tentar novamente", action: "exec", handler: "root" },
              { label: "🔙 Voltar", action: "back" },
            ],
          };
        }

        const list = await listClient.getList(listId, ctx.userId);
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
            { label: "🔄 Tentar novamente", action: "exec", handler: "root" },
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
        const { listId } = ctx.selectedList || {};
        if (!listId) {
          return {
            title: "❌ Erro: Lista não selecionada",
            options: [
              { label: "🔄 Tentar novamente", action: "exec", handler: "root" },
              { label: "🔙 Voltar", action: "back" },
            ],
          };
        }

        const list = await listClient.getList(listId, ctx.userId, 1);

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
            { label: "🔄 Tentar novamente", action: "exec", handler: "root" },
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
      const { item } = ctx.selectedItem || {};
      if (!item) {
        return {
          title: "❌ Erro: Item não selecionado",
          options: [
            { label: "🔄 Tentar novamente", action: "exec", handler: "root" },
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
        const { listId, listTitle } = ctx.selectedList || {};
        if (!listId) {
          return {
            title: "❌ Erro: Lista não selecionada",
            options: [{ label: "🔙 Voltar", action: "back" }],
          };
        }

        const list = await listClient.getList(listId, ctx.userId);
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
     * Selecionar uma lista para visualizar
     */
    selectList: async (ctx) => {
      try {
        const { listId, listTitle } = ctx.option?.data || {};
        if (!listId) {
          await ctx.reply("❌ Erro ao selecionar lista");
          return { end: false };
        }

        ctx.selectedList = { listId, listTitle };
        ctx.path = "/list-detail";
        if (!ctx.history.includes("/")) ctx.history.push("/");

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
        ctx.path = "/list-items";
        if (!ctx.history.includes("/list-detail")) {
          ctx.history.push("/list-detail");
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
        const { itemId, item } = ctx.option?.data || {};
        if (!itemId) {
          await ctx.reply("❌ Erro ao selecionar item");
          return { end: false };
        }

        ctx.selectedItem = { itemId, item };
        ctx.path = "/item-detail";
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
        if (!ctx.selectedItem?.itemId) {
          await ctx.reply("❌ Erro: Item não selecionado");
          return { end: false };
        }

        const itemId = ctx.selectedItem.itemId;
        const item = ctx.selectedItem.item;
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
        ctx.path = "/item-detail";
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
        if (!ctx.selectedItem?.itemId) {
          await ctx.reply("❌ Erro: Item não selecionado");
          return { end: false };
        }

        const itemId = ctx.selectedItem.itemId;
        await listClient.removeItem(itemId, ctx.userId);
        await ctx.reply("✅ Item removido da lista!");

        // Volta pra lista de items
        ctx.path = "/list-items";
        return { end: false };
      } catch (err) {
        console.error("[ListsFlow] Remove item error:", err.message);
        await ctx.reply("❌ Erro ao remover item");
        return { end: false };
      }
    },

    /**
     * Criar nova lista - instrui o usuário a usar comando
     */
    createList: async (ctx) => {
      try {
        await ctx.reply(
          "📝 Para criar uma lista, use:\n\n" +
            "`/criar-lista nome-da-lista`\n\n" +
            "Exemplo: `/criar-lista Filmes Favoritos`",
        );
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
        if (!ctx.selectedList?.listId) {
          await ctx.reply("❌ Erro: Lista não selecionada");
          return { end: false };
        }

        ctx.path = "/delete-list-confirm";
        if (!ctx.history.includes("/list-detail")) {
          ctx.history.push("/list-detail");
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
        if (!ctx.selectedList?.listId) {
          await ctx.reply("❌ Erro: Lista não selecionada");
          return { end: false };
        }

        const listId = ctx.selectedList.listId;
        const listTitle = ctx.selectedList.listTitle;

        await listClient.deleteList(listId, ctx.userId);
        await ctx.reply(`✅ Lista "${listTitle}" foi deletada com sucesso!`);

        // Volta pro menu raiz
        ctx.path = "/";
        ctx.history = [];
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
