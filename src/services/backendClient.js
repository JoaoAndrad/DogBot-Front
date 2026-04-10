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

/**
 * @param {string} path
 * @param {object|null} body
 * @param {string} [method]
 * @param {{ silentHttpStatuses?: number[] }} [opts] - não logar console.error para estes códigos (ex.: 404 esperado no sync companion)
 */
async function sendToBackend(path, body, method = "POST", opts = {}) {
  const silentHttpStatuses = Array.isArray(opts.silentHttpStatuses)
    ? opts.silentHttpStatuses
    : [];
  const url = process.env.BACKEND_URL || "http://localhost:8000";
  const options = {
    method,
    headers: getBackendHeaders(),
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url + path, options);
  } catch (netErr) {
    console.error("[backendClient] fetch falhou (rede/DNS)", {
      method,
      path: path.slice(0, 200),
      baseUrl: url,
      message: netErr.message,
    });
    throw netErr;
  }

  // Validate HTTP status: anything non-2xx is an error
  if (!res.ok) {
    const rawText = await res.text();
    let errorBody;
    try {
      errorBody = rawText ? JSON.parse(rawText) : {};
    } catch {
      const snippet = rawText
        ? rawText.slice(0, 500).replace(/\s+/g, " ")
        : "(corpo vazio)";
      errorBody = {
        error: "Resposta não-JSON do backend",
        rawSnippet: snippet,
      };
    }

    const msg =
      errorBody?.error ||
      errorBody?.message ||
      res.statusText ||
      "Unknown error";
    if (!silentHttpStatuses.includes(res.status)) {
      console.error("[backendClient] resposta HTTP não OK", {
        method,
        path: path.slice(0, 200),
        status: res.status,
        message: msg,
        body: errorBody,
      });
    }
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
