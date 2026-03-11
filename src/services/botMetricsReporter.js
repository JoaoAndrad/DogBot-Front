"use strict";

const fetch = require("node-fetch");
const config = require("../core/config");
const logger = require("../utils/logger");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (config && config.botSecret) headers["X-Bot-Secret"] = config.botSecret;
  if (process.env.POLL_SHARED_SECRET)
    headers["X-Internal-Secret"] = process.env.POLL_SHARED_SECRET;
  if (process.env.INTERNAL_API_SECRET)
    headers["X-Internal-Secret"] = process.env.INTERNAL_API_SECRET;
  return headers;
}

/**
 * Report a single event to the backend (command, message_received, message_processed, sticker_created, etc.).
 * Payload should include chatId and fromId when applicable for "per group" and "active users" stats.
 * @param {string} type - Event type
 * @param {object} [payload] - { commandName?, chatId?, fromId?, ... }
 */
async function reportEvent(type, payload = {}) {
  try {
    const res = await fetch(BACKEND_URL + "/api/internal/metrics", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ type, ...payload }),
    });
    if (!res.ok) {
      logger.debug(
        "[botMetricsReporter] reportEvent failed:",
        res.status,
        await res.text().catch(() => "")
      );
    }
  } catch (err) {
    logger.debug("[botMetricsReporter] reportEvent error:", err && err.message);
  }
}

/**
 * Report multiple events in one request (batch).
 * @param {Array<{ type: string, ...payload }>} events
 */
async function reportBatch(events) {
  if (!events || events.length === 0) return;
  try {
    const body = events.map((e) => {
      const { type, ...rest } = e;
      return { type, ...rest };
    });
    const res = await fetch(BACKEND_URL + "/api/internal/metrics", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ events: body }),
    });
    if (!res.ok) {
      logger.debug(
        "[botMetricsReporter] reportBatch failed:",
        res.status,
        await res.text().catch(() => "")
      );
    }
  } catch (err) {
    logger.debug("[botMetricsReporter] reportBatch error:", err && err.message);
  }
}

module.exports = {
  reportEvent,
  reportBatch,
};
