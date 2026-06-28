const fetch = require("node-fetch");
const querystring = require("querystring");

const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const BOT_SECRET = process.env.BOT_SECRET || process.env.INTERNAL_API_SECRET || "";

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "x-bot-secret": BOT_SECRET,
  };
}

async function _post(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

async function _get(path, params) {
  const qs = params ? `?${querystring.stringify(params)}` : "";
  const res = await fetch(`${BACKEND_URL}${path}${qs}`, { headers: authHeaders() });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: res.status, text }; }
}

/**
 * Creates a one-time auth link for the user to connect their Google account.
 * Returns { token, authUrl }
 */
async function startAuth(userId) {
  return _post("/api/financial/auth/start", { userId });
}

/**
 * Checks whether a user has completed OAuth and has a vault.
 * Returns { linked: boolean }
 */
async function checkAuthStatus(userId) {
  return _get("/api/financial/auth/status", { userId });
}

module.exports = { startAuth, checkAuthStatus };
