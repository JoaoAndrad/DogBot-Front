/**
 * listClient.js — Client para API de Listas
 * Wrapper para chamar endpoints /api/lists no backend
 */

const { sendToBackend } = require("./backendClient");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * Search para filmes/séries no TMDb
 * @param {string} query - Título do filme/série
 * @param {number} page - Página de resultados
 * @returns {Promise<array>} Array de resultados {tmdbId, title, year, posterUrl, type}
 */
async function searchMovies(query, page = 1) {
  try {
    const response = await sendToBackend(
      `/api/lists/tmdb/search?q=${encodeURIComponent(query)}&page=${page}`,
      null,
      "GET",
    );
    return response.results || [];
  } catch (err) {
    console.error("[ListClient] Search error:", err.message);
    throw err;
  }
}

/**
 * Get todas as listas do usuário ou listas de um grupo
 * @param {string} userIdOrGroupId - User ID or Group Chat ID (@g.us)
 * @param {number} page - Página
 * @param {string?} groupChatId - Opcional: se fornecido, busca listas do grupo em vez de listas do usuário
 * @returns {Promise<array>} Array de listas
 */
async function getUserLists(userIdOrGroupId, page = 1, groupChatId = null) {
  try {
    // Se groupChatId for explicitamente fornecido, use-o. Caso contrário, detecte pelo userIdOrGroupId
    const targetGroupId =
      groupChatId ||
      (String(userIdOrGroupId).endsWith("@g.us") ? userIdOrGroupId : null);

    // userId é sempre o primeiro parâmetro (userIdOrGroupId), a menos que ele mesmo seja um groupId
    const userId = String(userIdOrGroupId).endsWith("@g.us")
      ? null
      : userIdOrGroupId;

    let query;
    if (targetGroupId) {
      // Always include userId for authentication, even when querying group lists
      query =
        "/api/lists?groupChatId=" +
        encodeURIComponent(targetGroupId) +
        "&userId=" +
        encodeURIComponent(userId) +
        "&page=" +
        page;
      console.log(`[ListClient] 🔍 Query group lists: ${query}`);
    } else {
      query =
        "/api/lists?userId=" +
        encodeURIComponent(userIdOrGroupId) +
        "&page=" +
        page;
      console.log(`[ListClient] 🔍 Query user lists: ${query}`);
    }

    const response = await sendToBackend(query, null, "GET");
    console.log(
      `[ListClient] ✅ Response: ${response.lists?.length || 0} lists received`,
    );
    return response.lists || [];
  } catch (err) {
    console.error("[ListClient] Get user lists error:", err.message);
    throw err;
  }
}

/**
 * Get uma lista específica com items
 * @param {string} listId - List ID
 * @param {string} userId - User ID (para autorização)
 * @param {number} page - Página de items
 * @returns {Promise<object>} Lista com items
 */
async function getList(listId, userId, page = 1) {
  try {
    const response = await sendToBackend(
      `/api/lists/${listId}?page=${page}&userId=${userId}`,
      null,
      "GET",
    );
    return response;
  } catch (err) {
    console.error("[ListClient] Get list error:", err.message);
    throw err;
  }
}

/**
 * Get stats de uma lista
 * @param {string} listId - List ID
 * @returns {Promise<object>} Stats {total, watched, rated, avgRating}
 */
async function getListStats(listId) {
  try {
    const response = await sendToBackend(
      `/api/lists/${listId}/stats`,
      null,
      "GET",
    );
    return response;
  } catch (err) {
    console.error("[ListClient] Get stats error:", err.message);
    throw err;
  }
}

/**
 * Create uma nova lista
 * @param {string} userId - Owner user ID
 * @param {object} options - { title, description?, isPublic?, groupChatId? }
 * @returns {Promise<object>} Nova lista criada
 */
async function createList(
  userId,
  { title, description, isPublic = false, groupChatId = null },
) {
  try {
    console.log(
      `[ListClient] Creating list: title="${title}", userId=${userId}, groupChatId=${groupChatId}, isPublic=${isPublic}`,
    );

    const payload = {
      userId,
      title,
      description,
      isPublic,
    };

    if (groupChatId) {
      payload.groupChatId = groupChatId;
      console.log(
        `[ListClient] ✅ Including groupChatId in payload: ${groupChatId}`,
      );
    }

    const response = await sendToBackend("/api/lists", payload);
    console.log(`[ListClient] ✅ List created successfully: ${response.id}`);
    return response;
  } catch (err) {
    console.error("[ListClient] ❌ Create list error:", err.message);
    throw err;
  }
}

/**
 * Delete uma lista
 * @param {string} listId - List ID
 * @param {string} userId - User ID (para autorização)
 * @returns {Promise<object>} Confirmation
 */
async function deleteList(listId, userId) {
  try {
    const response = await sendToBackend(
      `/api/lists/${listId}`,
      { userId },
      "DELETE",
    );
    return response;
  } catch (err) {
    console.error("[ListClient] Delete list error:", err.message);
    throw err;
  }
}

/**
 * Adicionar item à lista
 * @param {string} listId - List ID
 * @param {string} tmdbId - TMDb ID do filme/série
 * @param {string} userId - User ID
 * @param {object} options - {title?, year?, posterUrl?}
 * @returns {Promise<object>} Item adicionado
 * @throws {Error} Backend error with status and body attached
 */
async function addToList(listId, tmdbId, userId, options = {}) {
  try {
    const response = await sendToBackend(`/api/lists/${listId}/items`, {
      userId,
      tmdbId,
      ...options,
    });
    console.log("[ListClient] ✅ Item added to list", { listId, tmdbId });
    return response;
  } catch (err) {
    console.error("[ListClient] ❌ Add to list error:", err.message, err.body);
    // Re-throw with full error context for caller to handle
    throw err;
  }
}

/**
 * Marcar item como assistido
 * @param {string} itemId - ListItem ID
 * @param {string} userId - User ID
 * @param {boolean} watched - true/false
 * @returns {Promise<object>} Item atualizado
 */
async function markWatched(itemId, userId, watched = true) {
  try {
    const response = await sendToBackend(
      `/api/lists/items/${itemId}/watched`,
      { userId, watched },
      "PATCH",
    );
    return response;
  } catch (err) {
    console.error("[ListClient] Mark watched error:", err.message);
    throw err;
  }
}

/**
 * Adicionar rating a um item
 * @param {string} itemId - ListItem ID
 * @param {string} userId - User ID
 * @param {number} rating - 0-5 ou null
 * @returns {Promise<object>} Item atualizado
 */
async function addRating(itemId, userId, rating) {
  try {
    const response = await sendToBackend(
      `/api/lists/items/${itemId}/rating`,
      { userId, rating },
      "PATCH",
    );
    return response;
  } catch (err) {
    console.error("[ListClient] Add rating error:", err.message);
    throw err;
  }
}

/**
 * Remover item da lista
 * @param {string} itemId - ListItem ID
 * @param {string} userId - User ID
 * @returns {Promise<object>} Confirmation
 */
async function removeItem(itemId, userId) {
  try {
    const response = await sendToBackend(
      `/api/lists/items/${itemId}`,
      { userId },
      "DELETE",
    );
    return response;
  } catch (err) {
    console.error("[ListClient] Remove item error:", err.message);
    throw err;
  }
}

module.exports = {
  searchMovies,
  getUserLists,
  getList,
  getListStats,
  createList,
  deleteList,
  addToList,
  markWatched,
  addRating,
  removeItem,
};
