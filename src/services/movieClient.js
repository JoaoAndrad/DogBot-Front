/**
 * services/movieClient.js — Client for direct movie API calls
 * Uses backendClient for proper Node.js HTTP support
 */

const { sendToBackend } = require("./backendClient");

/**
 * Mark movie as watched
 * @param {number} userId - User ID
 * @param {string} tmdbId - TMDb movie ID
 * @param {object} options - { title?, year?, posterUrl? }
 * @returns {Promise}
 */
async function markWatched(userId, tmdbId, options = {}) {
  const response = await sendToBackend("/api/movies/watched", {
    userId,
    tmdbId,
    ...options,
  });
  return response;
}

/**
 * Rate a movie
 * @param {number} userId - User ID
 * @param {string} tmdbId - TMDb movie ID
 * @param {number} rating - Rating 0-5
 * @param {object} options - { title?, year?, posterUrl? }
 * @returns {Promise}
 */
async function rateMovie(userId, tmdbId, rating, options = {}) {
  const response = await sendToBackend("/api/movies/rate", {
    userId,
    tmdbId,
    rating,
    ...options,
  });
  return response;
}

/**
 * Get movie info with user rating
 * @param {number} userId - User ID
 * @param {string} tmdbId - TMDb movie ID
 * @returns {Promise}
 */
async function getMovieInfo(userId, tmdbId) {
  const response = await sendToBackend(
    `/api/movies/${tmdbId}?userId=${userId}`,
    null,
    "GET",
  );
  return response;
}

/**
 * Get movie info with all users' ratings (for film card: show everyone who rated/watched)
 * @param {string} tmdbId - TMDb movie ID
 * @returns {Promise<object>} { title, year, overview, voteAverage, posterUrl, ratings: [{ displayName, watched, rating, watchedAt, ratedAt }, ...] }
 */
async function getMovieInfoWithAllRatings(tmdbId) {
  const response = await sendToBackend(
    `/api/movies/${tmdbId}/ratings`,
    null,
    "GET",
  );
  return response;
}

/**
 * Get user's watched movies
 * @param {number} userId - User ID
 * @param {object} options - { rated?, page?, pageSize? }
 * @returns {Promise}
 */
async function getWatchedMovies(userId, options = {}) {
  const params = new URLSearchParams({ userId, ...options });
  const response = await sendToBackend(`/api/movies?${params}`, null, "GET");
  return response;
}

/**
 * Get user's movie stats
 * @param {number} userId - User ID
 * @returns {Promise}
 */
async function getMovieStats(userId) {
  const response = await sendToBackend(
    `/api/movies/stats/${userId}`,
    null,
    "GET",
  );
  return response;
}

/**
 * Get user's top rated movies
 * @param {number} userId - User ID
 * @param {number} limit - Number of movies
 * @returns {Promise}
 */
async function getTopRatedMovies(userId, limit = 10) {
  const response = await sendToBackend(
    `/api/movies/top/${userId}?limit=${limit}`,
    null,
    "GET",
  );
  return response;
}

/**
 * Search TMDb for movies
 * @param {string} query - Search query
 * @param {object} options - { type?, page? }
 * @returns {Promise}
 */
async function searchMovies(query, options = {}) {
  const params = new URLSearchParams({ q: query, ...options });
  const response = await sendToBackend(
    `/api/movies/search/tmdb?${params}`,
    null,
    "GET",
  );
  return response;
}

/**
 * Remove movie rating
 * @param {number} userId - User ID
 * @param {string} tmdbId - TMDb movie ID
 * @returns {Promise}
 */
async function removeRating(userId, tmdbId) {
  const response = await sendToBackend(
    `/api/movies/${tmdbId}?userId=${userId}`,
    null,
    "DELETE",
  );

  return response;
}

module.exports = {
  markWatched,
  rateMovie,
  getMovieInfo,
  getMovieInfoWithAllRatings,
  getWatchedMovies,
  getMovieStats,
  getTopRatedMovies,
  searchMovies,
  removeRating,
};
