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
 * Get todas as listas do usuário
 * @param {string} userId - User ID
 * @param {number} page - Página
 * @returns {Promise<array>} Array de listas
 */
async function getUserLists(userId, page = 1) {
  try {
    const response = await sendToBackend("/api/lists", { userId, page }, "GET");
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
 * @param {object} data - {title, description?, isPublic?}
 * @returns {Promise<object>} Lista criada
 */
async function createList(userId, { title, description, isPublic = false }) {
  try {
    const response = await sendToBackend("/api/lists", {
      userId,
      title,
      description,
      isPublic,
    });
    return response;
  } catch (err) {
    console.error("[ListClient] Create list error:", err.message);
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
 */
async function addToList(listId, tmdbId, userId, options = {}) {
  try {
    const response = await sendToBackend(`/api/lists/${listId}/items`, {
      userId,
      tmdbId,
      ...options,
    });
    return response;
  } catch (err) {
    console.error("[ListClient] Add to list error:", err.message);
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
