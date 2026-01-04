const fetch = require("node-fetch");
const querystring = require("querystring");

const BACKEND_URL = process.env.BACKEND_URL;

async function post(path, body) {
  const res = await fetch(BACKEND_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: res.status, text };
  }
}

async function get(path, params) {
  const url =
    BACKEND_URL + path + (params ? `?${querystring.stringify(params)}` : "");
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { status: res.status, text };
  }
}

module.exports = {
  // Start OAuth flow: returns { auth_url, state }
  startAuth: async function (opts) {
    return post("/spotify/start/", opts || {});
  },

  // Helper to poll token status if needed
  getTokenStatus: async function (tokenId) {
    return get(`/spotify/tokens/${tokenId}/`);
  },

  // Search tracks via backend proxy
  searchTracks: async function (q) {
    return get("/spotify/tracks/", { q });
  },

  // Playlist entries
  getPlaylistEntries: async function (playlistId, page = 1, pageSize = 50) {
    return get("/spotify/playlist-entries/", {
      playlist_id: playlistId,
      page,
      page_size: pageSize,
    });
  },

  addPlaylistEntry: async function (payload) {
    return post("/spotify/playlist-entries/", payload);
  },

  vote: async function (payload) {
    return post("/spotify/votes/", payload);
  },

  getCurrentTracks: async function () {
    return get("/spotify/current-tracks/");
  },

  // Simple SSE connection helper (backend should expose /spotify/events/ or similar)
  connectSSE: function (path = "/spotify/events/") {
    const EventSource = require("eventsource");
    const url = BACKEND_URL.replace(/^http/, "http") + path;
    const es = new EventSource(url);
    return es;
  },
};
