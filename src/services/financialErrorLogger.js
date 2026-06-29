"use strict";

const backendClient = require("./backendClient");

/**
 * Logs a financial module error to the backend (fire-and-forget).
 * @param {{ userId?: string, source: string, action?: string, error: Error|unknown }} opts
 */
function logFinancialError({ userId, source, action, error }) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  backendClient
    .sendToBackend("/api/internal/financial-error-log", { userId, source, action, message, stack })
    .catch(() => {});
}

module.exports = { logFinancialError };
