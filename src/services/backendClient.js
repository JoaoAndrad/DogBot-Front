const fetch = require("node-fetch");
const config = require("../core/config");

async function sendToBackend(path, body, method = "POST") {
  // include internal secret header if provided by env/config
  const url = process.env.BACKEND_URL || "http://localhost:8000";
  const headers = { "Content-Type": "application/json" };
  if (config && config.botSecret) headers["X-Bot-Secret"] = config.botSecret;
  if (process.env.POLL_SHARED_SECRET)
    headers["X-Internal-Secret"] = process.env.POLL_SHARED_SECRET;
  if (process.env.INTERNAL_API_SECRET)
    headers["X-Internal-Secret"] = process.env.INTERNAL_API_SECRET;

  const options = {
    method,
    headers,
  };

  // Only add body for POST/PUT/PATCH requests
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url + path, options);
  return res.json();
}

module.exports = { sendToBackend };
