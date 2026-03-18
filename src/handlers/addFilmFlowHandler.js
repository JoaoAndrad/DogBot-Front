/**
 * addFilmFlowHandler - Handle film addition to list flow
 * Steps:
 * 0 - Search film and show list options
 * 1 - Collect list selection
 * 2 - Add film to selected list
 */

const conversationState = require("../services/conversationState");
const listClient = require("../services/listClient");
const movieClient = require("../services/movieClient");
const logger = require("../utils/logger");

async function handleAddFilmFlow(userId, body, state, reply, context) {
  const { step, data } = state;

  logger.info(
    `[AddFilmFlow] Handler chamado para userId=${userId}, step=${step}, body="${body}"`,
  );

  // Step 0: Search film and show list options
  if (step === 0) {
    const filmName = data.filmName || body.trim();

    if (!filmName) {
      conversationState.clearState(userId);
      return reply("❌ Nenhum nome de filme fornecido");
    }

    try {
      logger.info(`[AddFilmFlow] Buscando filme: "${filmName}"`);

      // Search for film
      const searchResults = await movieClient.searchMovies(filmName, {
        type: "multi",
        page: 1,
      });

      const results = searchResults.results || [];
      if (!results || results.length === 0) {
        conversationState.clearState(userId);
        return reply(`❌ Nenhum filme encontrado para: ${filmName}`);
      }

      const film = results[0];
      const filmTitle = `${film.title}${film.year ? ` (${film.year})` : ""}`;

      // Save film data
      conversationState.updateData(userId, {
        tmdbId: film.tmdbId,
        filmTitle,
        filmData: film,
      });

      // Get user lists
      const lists = await listClient.getUserLists(userId);

      if (lists.length === 0) {
        conversationState.clearState(userId);
        return reply(
          `📽️ *${filmTitle}*\n\n` +
            `❌ Você não tem listas criadas!\n\n` +
            `Use /criar-lista para criar sua primeira lista`,
        );
      }

      // Show list options
      conversationState.updateData(userId, { lists });
      conversationState.nextStep(userId);

      let optionsText =
        `📽️ *${filmTitle}*\n\n` +
        `Selecione uma lista para adicionar este filme:\n\n`;

      lists.forEach((list, idx) => {
        optionsText += `*${idx + 1}. ${list.title}* (${list._count.items} items)\n`;
      });

      optionsText += `\nDigite apenas o número (ex: 1, 2, 3...)`;

      return reply(optionsText);
    } catch (err) {
      logger.error("[AddFilmFlow] Erro ao buscar filme:", err.message);
      conversationState.clearState(userId);
      return reply(`❌ Erro ao buscar filme: ${err.message}`);
    }
  }

  // Step 1: Collect list selection
  if (step === 1) {
    const listIndex = parseInt(body.trim());
    const { lists, tmdbId, filmTitle, filmData } = data;

    // Validate selection
    if (isNaN(listIndex) || listIndex < 1 || listIndex > lists.length) {
      return reply(
        `❌ Opção inválida! Digite um número entre 1 e ${lists.length}`,
      );
    }

    const selectedList = lists[listIndex - 1];

    try {
      logger.info(
        `[AddFilmFlow] Adicionando filme ${tmdbId} à lista ${selectedList.id}`,
      );

      // Add film to list
      await listClient.addToList(selectedList.id, tmdbId, userId, {
        title: filmData.title,
        year: filmData.year,
        posterUrl: filmData.posterUrl,
        mediaType: filmData.mediaType,
      });

      conversationState.clearState(userId);

      return reply(
        `✅ *${filmTitle}* adicionado com sucesso!\n\n` +
          `📋 Lista: ${selectedList.title}\n\n` +
          `💡 Use /listas para gerenciar suas listas`,
      );
    } catch (err) {
      logger.error("[AddFilmFlow] Erro ao adicionar filme:", err.message);
      conversationState.clearState(userId);

      // Check if film already in list
      if (err.message.includes("already")) {
        return reply(`⚠️ Este filme já está nesta lista!`);
      }

      return reply(`❌ Erro ao adicionar filme: ${err.message}`);
    }
  }
}

module.exports = { handleAddFilmFlow };
