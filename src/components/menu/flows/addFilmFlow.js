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
        const userId = ctx.userId;
        const filmName = ctx.state?.context?.filmName;
        const tmdbId = ctx.state?.context?.tmdbId;

        let film;
        let filmTitle;

        if (tmdbId) {
          // From film-card: use tmdbId, skip search
          logger.info(`[AddFilmFlow🔍] Usando tmdbId: ${tmdbId}`);
          try {
            film = await movieClient.getMovieInfo(userId, tmdbId);
            filmTitle =
              ctx.state.context.filmTitle ||
              `${film.title}${film.year ? ` (${film.year})` : ""}`;
            ctx.state.context.tmdbId = tmdbId;
            ctx.state.context.filmTitle = filmTitle;
            ctx.state.context.filmData = film;
          } catch (err) {
            logger.warn(`[AddFilmFlow❌] Filme não encontrado por ID: ${tmdbId}`);
            return {
              title: `❌ Filme com ID ${tmdbId} não encontrado`,
              options: [{ label: "🔙 Voltar", action: "back" }],
            };
          }
          logger.info(
            `[AddFilmFlow✅] Filme carregado: ${filmTitle} (tmdbId: ${tmdbId})`,
          );
        } else {
          if (!filmName) {
            return {
              title: "❌ Erro: Nome do filme não fornecido",
              options: [{ label: "🔙 Voltar", action: "back" }],
            };
          }

          logger.info(`[AddFilmFlow🔍] Buscando filme: "${filmName}"`);

          const searchResults = await movieClient.searchMovies(filmName, {
            type: "multi",
            page: 1,
          });

          const results = Array.isArray(searchResults)
            ? searchResults
            : searchResults?.results || [];
          if (!results || results.length === 0) {
            logger.warn(`[AddFilmFlow❌] Filme não encontrado: "${filmName}"`);
            return {
              title: `❌ Nenhum filme encontrado para: "${filmName}"`,
              options: [{ label: "🔙 Voltar", action: "back" }],
            };
          }

          film = results[0];
          filmTitle = `${film.title}${film.year ? ` (${film.year})` : ""}`;
          logger.info(
            `[AddFilmFlow✅] Filme encontrado: ${filmTitle} (tmdbId: ${film.tmdbId})`,
          );

          ctx.state.context.tmdbId = film.tmdbId;
          ctx.state.context.filmTitle = filmTitle;
          ctx.state.context.filmData = film;
        }

        // Get lists for user or group
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

        // Log detailed info about each list
        lists.forEach((list, idx) => {
          const ownerInfo = list.owner
            ? `${list.owner.push_name}`
            : "Desconhecido";
          const visibility = list.isPublic ? "🔓 Pública" : "🔒 Privada";
          const itemCount = list._count?.items || 0;
          logger.debug(
            `[AddFilmFlow📋] Lista ${idx + 1}: "${list.title}" | ID: ${list.id} | Items ANTES: ${itemCount} | Owner: ${ownerInfo} | ${visibility}`,
          );
        });

        if (lists.length === 0) {
          const msgPrivate =
            `📽️ *${filmTitle}*\n\n` +
            `Você ainda não tem listas!\n\n` +
            `Crie sua primeira lista com:\n` +
            `/criar-lista nome da lista\n\n` +
            `💡 Listas que você criar aqui no privado são só suas. Se criar uma lista em um grupo, ela fica visível para todos do grupo — para uma lista só sua, crie aqui no meu privado.\n\n` +
            `Ou use o comando /listas`;
          const msgGroup =
            `📽️ *${filmTitle}*\n\n` +
            `Ainda não há listas neste grupo!\n\n` +
            `Alguém pode criar a primeira com:\n` +
            `/criar-lista nome da lista\n\n` +
            `💡 Listas criadas no grupo são visíveis para todos. Para uma lista só sua, crie no meu privado.\n\n` +
            `Ou use o comando /listas`;
          return {
            title: isGroup ? msgGroup : msgPrivate,
            skipPoll: true,
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
                .map((l) => `"${l.title}" (${l._count.items} items)`)
                .join(", ");
              return `  👤 ${owner}: ${listTitles}`;
            })
            .join("\n");
          logger.info(`📋 Listas de usuários do grupo:\n${groupSummary}`);
        }

        // Save lists to context
        ctx.state.context.lists = lists;

        // Create poll options with all necessary film data
        const options = lists.map((list) => {
          const optionData = {
            listId: list.id,
            listIndex: lists.indexOf(list),
            tmdbId: film.tmdbId,
            filmTitle,
            filmData: film,
          };
          logger.debug(
            `[AddFilmFlow📋] Option data: ${JSON.stringify({ listId: list.id, tmdbId: film.tmdbId, filmTitle })}`,
          );
          return {
            label:
              `📋 ${list.title} (${list._count.items} items)` +
              (isGroup && list.owner ? ` - ${list.owner.push_name}` : ""),
            action: "exec",
            handler: "selectList",
            data: optionData,
          };
        });

        options.push({ label: "🔙 Voltar", action: "back" });

        return {
          title: `📽️ *${filmTitle}*\n\nSelecione uma lista:`,
          options,
          skipPoll: false,
        };
      } catch (err) {
        logger.error("[AddFilmFlow] Root handler error:", err.message);
        return {
          title: "❌ Erro ao buscar filme.\n\nOu use o comando /listas",
          skipPoll: true,
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
        // Data comes from ctx.data (backend response) with all poll option data
        const { listId, tmdbId, filmTitle, filmData } = ctx.data || {};

        logger.info(`[AddFilmFlow👆] Handler selectList chamado`);
        logger.debug(
          `[AddFilmFlow👆] Contexto: userId=${ctx.userId}, chatId=${ctx.chatId}, flowId=${ctx.flowId}`,
        );
        logger.debug(
          `[AddFilmFlow👆] Dados recebidos: listId=${listId}, tmdbId=${tmdbId}, filmTitle=${filmTitle}`,
        );

        if (!listId || !tmdbId) {
          logger.error(
            `[AddFilmFlow❌] Dados faltando! ctx.data:`,
            JSON.stringify(ctx.data),
          );
          await ctx.reply("❌ Erro ao processar seleção (dados incompletos)");
          return { end: false };
        }
        logger.info(`[AddFilmFlow✅] Dados validados: pronto para adicionar`);

        logger.info(
          `[AddFilmFlow🎬] Adicionando filme ${tmdbId} (${filmTitle}) à lista ${listId}`,
        );

        // Add film to list with safe data extraction
        const filmDataPayload = {
          title:
            filmData?.title || filmTitle?.split("(")[0].trim() || "Unknown", // Fallback from title
          year: filmData?.year,
          posterUrl: filmData?.posterUrl,
          mediaType: filmData?.mediaType || "movie",
        };

        logger.info(
          `[AddFilmFlow📦] Payload para adicionar: ${JSON.stringify(
            filmDataPayload,
          )}`,
        );

        let addResult;
        try {
          addResult = await listClient.addToList(
            listId,
            tmdbId,
            ctx.userId,
            filmDataPayload,
          );
          logger.info(`[AddFilmFlow✅] Filme adicionado com sucesso!`);
        } catch (err) {
          // Backend error - throw so handler catches and reports failure
          logger.error(
            `[AddFilmFlow❌] Backend falhou ao adicionar filme:`,
            err.message,
          );
          throw err;
        }

        logger.info(
          `[AddFilmFlow📊] Resultado do backend: ${JSON.stringify(addResult)}`,
        );

        // Verify: Fetch updated list to confirm item was added
        logger.debug(
          `[AddFilmFlow🔍] Verificando se item foi realmente adicionado...`,
        );
        try {
          const updatedLists = await listClient.getUserLists(
            ctx.userId,
            1,
            String(ctx.chatId).endsWith("@g.us") ? ctx.chatId : null,
          );
          const updatedList = updatedLists.find((l) => l.id === listId);
          if (updatedList) {
            const newItemCount = updatedList._count?.items || 0;
            logger.info(
              `[AddFilmFlow📊] Item count DEPOIS: ${newItemCount} (lista: ${updatedList.title})`,
            );
          }
        } catch (verifyErr) {
          logger.debug(
            `[AddFilmFlow🔍] Não conseguiu verificar lista atualizada: ${verifyErr.message}`,
          );
        }

        // SUCCESS: Only now send success message after confirmed persistence
        await ctx.reply(
          `✅ *${filmTitle}* adicionado com sucesso!\n\n` +
            `🎬 Agora está na lista\n\n` +
            `💡 Use /listas para gerenciar suas listas`,
        );

        return { end: true };
      } catch (err) {
        logger.error(`[AddFilmFlow❌] selectList error:`, err.message);
        logger.debug(`[AddFilmFlow🔍] Stack: ${err.stack}`);

        // FAILURE: Send error message to user - NO success message
        let errorMsg = `❌ Erro ao adicionar filme: ${err.message}`;

        // Provide helpful context for common errors
        if (
          err.message.includes("already in list") ||
          err.message.includes("already")
        ) {
          errorMsg = `⚠️ Este filme já está nesta lista!`;
        } else if (err.message.includes("not found")) {
          errorMsg = `❌ Lista não encontrada ou foi deletada`;        if (lists.length === 0) {
          const msgPrivate =
            `📽️ *${filmTitle}*\n\n` +
            `Você ainda não tem listas!\n\n` +
            `Crie sua primeira lista com:\n` +
            `/criar-lista nome da lista\n\n` +
            `💡 Listas que você criar aqui no privado são só suas. Se criar uma lista em um grupo, ela fica visível para todos do grupo, para uma lista só sua, crie aqui no meu privado.`;
          const msgGroup =
            `📽️ *${filmTitle}*\n\n` +
            `Ainda não há listas neste grupo!\n\n` +
            `Alguém pode criar a primeira com:\n` +
            `/criar-lista nome da lista\n\n` +
            `💡 Listas criadas no grupo são visíveis para todos. Para uma lista só sua, crie no meu privado.`;
          return {
            title: isGroup ? msgGroup : msgPrivate,
            skipPoll: true,
          };
        } else if (err.message.includes("Unauthorized")) {
          errorMsg = `❌ Você não tem permissão para adicionar a essa lista`;
        }

        await ctx.reply(errorMsg);

        return { end: true };
      }
    },
  },
});

module.exports = addFilmFlow;
