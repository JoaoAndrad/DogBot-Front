const url = require("url");

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const INTERNAL_SECRET = process.env.POLL_SHARED_SECRET || null;

let _fetch = global.fetch;
if (!_fetch) {
  try {
    _fetch = require("node-fetch");
  } catch (e) {
    throw new Error(
      "No fetch available. Install node-fetch or run on Node 18+."
    );
  }
}

function _headers() {
  const h = { "Content-Type": "application/json" };
  if (INTERNAL_SECRET) h["X-Internal-Secret"] = INTERNAL_SECRET;
  return h;
}

/**
 * Save or update menu state
 * @param {string} userId
 * @param {string} flowId
 * @param {object} state - { path, history, context, expiresAt }
 * @returns {Promise<MenuState>}
 */
async function saveState(userId, flowId, state) {
  const payload = {
    userId,
    flowId,
    path: state.path || "/",
    history: state.history || [],
    context: state.context || {},
    expiresAt: state.expiresAt || null,
  };

  const res = await _fetch(url.resolve(BACKEND_URL, "/api/menu/state"), {
    method: "POST",
    headers: _headers(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`saveState failed: ${res.status} ${txt}`);
  }

  return res.json();
}

/**
 * Get menu state
 * @param {string} userId
 * @param {string} flowId
 * @returns {Promise<MenuState|null>}
 */
async function getState(userId, flowId) {
  const res = await _fetch(
    url.resolve(
      BACKEND_URL,
      `/api/menu/state/${encodeURIComponent(userId)}/${encodeURIComponent(
        flowId
      )}`
    ),
    {
      method: "GET",
      headers: _headers(),
    }
  );

  if (res.status === 404) return null;

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`getState failed: ${res.status} ${txt}`);
  }

  return res.json();
}

/**
 * Delete menu state
 * @param {string} userId
 * @param {string} flowId
 * @returns {Promise<boolean>}
 */
async function deleteState(userId, flowId) {
  const res = await _fetch(
    url.resolve(
      BACKEND_URL,
      `/api/menu/state/${encodeURIComponent(userId)}/${encodeURIComponent(
        flowId
      )}`
    ),
    {
      method: "DELETE",
      headers: _headers(),
    }
  );

  if (res.status === 404) return false;

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`deleteState failed: ${res.status} ${txt}`);
  }

  return true;
}

/**
 * List all states for a user
 * @param {string} userId
 * @returns {Promise<MenuState[]>}
 */
async function listStates(userId) {
  const res = await _fetch(
    url.resolve(BACKEND_URL, `/api/menu/state/${encodeURIComponent(userId)}`),
    {
      method: "GET",
      headers: _headers(),
    }
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`listStates failed: ${res.status} ${txt}`);
  }

  return res.json();
}

module.exports = {
  saveState,
  getState,
  deleteState,
  listStates,
};
