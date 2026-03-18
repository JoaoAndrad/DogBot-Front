/**
 * components/menu/flows/addFilmFlow.js — Flow interativo para adicionar filmes a listas
 * Menu: Buscar filme → Selecionar lista → Adicionar à lista
 */

const { createFlow } = require("../flowBuilder");
const listClient = require("../../../services/listClient");
const movieClient = require("../../../services/movieClient");
const logger = require("../../../utils/logger");

const addFilmFlow = createFlow("add-film", {
  root: {
    title: "📽️ Adicionar Filme",
    dynamic: true,
    handler: async (ctx) => {
      try {
        // Get film search data from initial context
        const filmName = ctx.state?.context?.filmName;

        if (!filmName) {
          return {
            title: "❌ Erro: Nome do filme não fornecido",
            options: [{ label: "🔙 Voltar", action: "back" }],
          };
        }

        logger.info(`[AddFilmFlow] Buscando filme: "${filmName}"`);

        // Search for film
        const searchResults = await movieClient.searchMovies(filmName, {
          type: "multi",
          page: 1,
        });

        // searchResults can be either an array or { results: [] }
        const results = Array.isArray(searchResults)
          ? searchResults
          : searchResults?.results || [];
        if (!results || results.length === 0) {
          return {
            title: `❌ Nenhum filme encontrado para: "${filmName}"`,
            options: [{ label: "🔙 Voltar", action: "back" }],
          };
        }

        const film = results[0];
        const filmTitle = `${film.title}${film.year ? ` (${film.year})` : ""}`;

        // Save film data to context for next step
        ctx.state.context.tmdbId = film.tmdbId;
        ctx.state.context.filmTitle = filmTitle;
        ctx.state.context.filmData = film;

        // Get lists for user or group
        const userId = ctx.userId;
        const chatId = ctx.chatId || ctx.from;
        const isGroup = chatId && String(chatId).endsWith("@g.us");
        const groupChatId = isGroup ? chatId : null;

        logger.info(
          `[AddFilmFlow] 📋 Fetching lists... isGroup=${isGroup}, groupChatId=${groupChatId}, userId=${userId}`,
        );
        const lists = await listClient.getUserLists(userId, 1, groupChatId);
        logger.info(
          `[AddFilmFlow] ✅ Fetched ${lists.length} lists. isGroup=${isGroup}`,
        );

        if (lists.length === 0) {
          return {
            title:
              `📽️ *${filmTitle}*\n\n` +
              `❌ Você não tem listas criadas!\n\n` +
              `Use /criar-lista para criar sua primeira lista`,
            options: [{ label: "🔙 Voltar", action: "back" }],
          };
        }

        // Log group list detection
        if (isGroup && lists.length > 0) {
          const listsByOwner = {};
          lists.forEach((list) => {
            const ownerName =
              list.owner?.push_name || list.ownerUserId || "Desconhecido";
            if (!listsByOwner[ownerName]) {
              listsByOwner[ownerName] = [];
            }
            listsByOwner[ownerName].push(list);
          });
          const groupSummary = Object.entries(listsByOwner)
            .map(([owner, ownerLists]) => {
              const listTitles = ownerLists
                .map((l) => `"${l.title}"`)
                .join(", ");
              return `  👤 ${owner}: ${listTitles}`;
            })
            .join("\n");
          logger.info(`📋 Listas de usuários do grupo:\n${groupSummary}`);
        }

        // Save lists to context
        ctx.state.context.lists = lists;

        // Create poll options with all necessary film data
        const options = lists.map((list) => ({
          label:
            `📋 ${list.title} (${list._count.items} items)` +
            (isGroup && list.owner ? ` - ${list.owner.push_name}` : ""),
          action: "exec",
          handler: "selectList",
          data: {
            listId: list.id,
            listIndex: lists.indexOf(list),
            tmdbId: film.tmdbId,
            filmTitle,
            filmData: film,
          },
        }));

        options.push({ label: "🔙 Voltar", action: "back" });

        return {
          title: `📽️ *${filmTitle}*\n\nSelecione uma lista:`,
          options,
          skipPoll: false,
        };
      } catch (err) {
        logger.error("[AddFilmFlow] Root handler error:", err.message);
        return {
          title: "❌ Erro ao buscar filme",
          options: [{ label: "🔙 Voltar", action: "back" }],
        };
      }
    },
  },

  handlers: {
    /**
     * Selecionar uma lista e adicionar filme
     */
    selectList: async (ctx) => {
      try {
        // Data can come from ctx.option?.data (poll selection) or ctx.data (backend response)
        const optionData = ctx.option?.data || ctx.data || {};
        const { listId, tmdbId, filmTitle, filmData } = optionData;

        logger.debug(
          `[AddFilmFlow] selectList - ctx.option?.data:`,
          ctx.option?.data,
        );
        logger.debug(`[AddFilmFlow] selectList - ctx.data:`, ctx.data);
        logger.debug(`[AddFilmFlow] selectList - extracted:`, {
          listId,
          tmdbId,
          filmTitle,
        });

        if (!listId || !tmdbId) {
          logger.error(
            `[AddFilmFlow] Missing required data: listId=${listId}, tmdbId=${tmdbId}`,
          );
          await ctx.reply("❌ Erro ao processar seleção");
          return { end: false };
        }

        logger.info(
          `[AddFilmFlow] Adicionando filme ${tmdbId} (${filmTitle}) à lista ${listId}`,
        );

        // Add film to list
        await listClient.addToList(listId, tmdbId, ctx.userId, {
          title: filmData.title,
          year: filmData.year,
          posterUrl: filmData.posterUrl,
          mediaType: filmData.mediaType,
        });

        logger.info(`[AddFilmFlow] ✅ Filme adicionado com sucesso!`);

        await ctx.reply(
          `✅ *${filmTitle}* adicionado com sucesso!\n\n` +
            `🎬 Agora está na lista\n\n` +
            `💡 Use /listas para gerenciar suas listas`,
        );

        return { end: true };
      } catch (err) {
        logger.error("[AddFilmFlow] selectList error:", err.message);
        await ctx.reply(`❌ Erro ao adicionar filme: ${err.message}`);

        if (err.message.includes("already")) {
          await ctx.reply(`⚠️ Este filme já está nesta lista!`);
        }

        return { end: true };
      }
    },
  },
});

module.exports = addFilmFlow;
