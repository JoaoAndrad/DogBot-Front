/**
 * services/movieClient.js — Client for direct movie API calls
 */

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:3000/api";

class MovieClient {
  /**
   * Mark movie as watched
   * @param {string} tmdbId - TMDb movie ID
   * @param {object} options - { title?, year?, posterUrl? }
   * @returns {Promise}
   */
  async markWatched(tmdbId, options = {}) {
    const response = await fetch(`${BASE_URL}/movies/watched`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdbId, ...options }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to mark as watched");
    }

    return response.json();
  }

  /**
   * Rate a movie
   * @param {string} tmdbId - TMDb movie ID
   * @param {number} rating - Rating 0-5
   * @param {object} options - { title?, year?, posterUrl? }
   * @returns {Promise}
   */
  async rateMovie(tmdbId, rating, options = {}) {
    const response = await fetch(`${BASE_URL}/movies/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdbId, rating, ...options }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to rate movie");
    }

    return response.json();
  }

  /**
   * Get movie info with user rating
   * @param {string} tmdbId - TMDb movie ID
   * @returns {Promise}
   */
  async getMovieInfo(tmdbId) {
    const response = await fetch(`${BASE_URL}/movies/${tmdbId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get movie info");
    }

    return response.json();
  }

  /**
   * Get user's watched movies
   * @param {object} options - { rated?, page?, pageSize? }
   * @returns {Promise}
   */
  async getWatchedMovies(options = {}) {
    const params = new URLSearchParams(options);
    const response = await fetch(`${BASE_URL}/movies?${params}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get watched movies");
    }

    return response.json();
  }

  /**
   * Get user's movie stats
   * @param {string} userId - User ID
   * @returns {Promise}
   */
  async getMovieStats(userId) {
    const response = await fetch(`${BASE_URL}/movies/stats/${userId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get movie stats");
    }

    return response.json();
  }

  /**
   * Get user's top rated movies
   * @param {string} userId - User ID
   * @param {number} limit - Number of movies
   * @returns {Promise}
   */
  async getTopRatedMovies(userId, limit = 10) {
    const response = await fetch(
      `${BASE_URL}/movies/top/${userId}?limit=${limit}`,
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get top rated movies");
    }

    return response.json();
  }

  /**
   * Search TMDb for movies
   * @param {string} query - Search query
   * @param {object} options - { type?, page? }
   * @returns {Promise}
   */
  async searchMovies(query, options = {}) {
    const params = new URLSearchParams({ q: query, ...options });
    const response = await fetch(`${BASE_URL}/movies/search/tmdb?${params}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to search movies");
    }

    return response.json();
  }

  /**
   * Remove movie rating
   * @param {string} tmdbId - TMDb movie ID
   * @returns {Promise}
   */
  async removeRating(tmdbId) {
    const response = await fetch(`${BASE_URL}/movies/${tmdbId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to remove rating");
    }

    return response.json();
  }
}

module.exports = new MovieClient();
