/**
 * services/bookClient.js — Client for /api/books
 */

const { sendToBackend } = require("./backendClient");

async function markRead(userId, workId, options = {}) {
  return sendToBackend("/api/books/read", {
    userId,
    workId,
    ...options,
  });
}

async function rateBook(userId, workId, rating, options = {}) {
  return sendToBackend("/api/books/rate", {
    userId,
    workId,
    rating,
    ...options,
  });
}

async function getBookInfo(userId, workId) {
  const path = `/api/books/${encodeURIComponent(workId)}?userId=${encodeURIComponent(userId)}`;
  return sendToBackend(path, null, "GET");
}

async function getBookInfoWithAllRatings(workId, userId) {
  let path = `/api/books/${encodeURIComponent(workId)}/ratings`;
  if (userId) {
    path += `?userId=${encodeURIComponent(userId)}`;
  }
  return sendToBackend(path, null, "GET");
}

async function searchBooks(query, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return sendToBackend(`/api/books/search/openlibrary?${params}`, null, "GET");
}

module.exports = {
  markRead,
  rateBook,
  getBookInfo,
  getBookInfoWithAllRatings,
  searchBooks,
};
