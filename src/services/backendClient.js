const fetch = require("node-fetch");
const config = require("../core/config");

function getBackendHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (config && config.botSecret) headers["X-Bot-Secret"] = config.botSecret;
  if (process.env.POLL_SHARED_SECRET)
    headers["X-Internal-Secret"] = process.env.POLL_SHARED_SECRET;
  if (process.env.INTERNAL_API_SECRET)
    headers["X-Internal-Secret"] = process.env.INTERNAL_API_SECRET;
  return headers;
}

async function sendToBackend(path, body, method = "POST") {
  const url = process.env.BACKEND_URL || "http://localhost:8000";
  const options = {
    method,
    headers: getBackendHeaders(),
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url + path, options);

  // Validate HTTP status: anything non-2xx is an error
  if (!res.ok) {
    let errorBody;
    try {
      errorBody = await res.json();
    } catch {
      errorBody = { error: "Failed to parse error response" };
    }

    const msg =
      errorBody?.error ||
      errorBody?.message ||
      res.statusText ||
      "Unknown error";
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = errorBody;
    throw err;
  }

  return res.json();
}

/**
 * GET request that returns response body as text (e.g. /api/status?format=message).
 * @param {string} path - Path including query string, e.g. "/api/status?format=message&hoursBack=24"
 * @returns {Promise<string>}
 */
async function getBackendText(path) {
  const url = process.env.BACKEND_URL || "http://localhost:8000";
  const res = await fetch(url + path, {
    method: "GET",
    headers: getBackendHeaders(),
  });
  return res.text();
}

module.exports = { sendToBackend, getBackendText };
