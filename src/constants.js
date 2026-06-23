/**
 * Operational constants for the bot.
 * Defaults live here; override via env vars if needed.
 */

const e = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const eb = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v !== "false";
};

// ── MessageGate ──────────────────────────────────────────────────────────────

/** Minimum ms between each outgoing message (token refill rate). */
const GATE_RATE_MS = e("GATE_RATE_MS", 800);

/** Initial burst tokens — first N messages go out without waiting. */
const GATE_BURST = e("GATE_BURST", 3);

/** Queue length that triggers the admin poll (gate pauses). */
const GATE_QUEUE_MAX = e("GATE_QUEUE_MAX", 50);

/** Queue length that logs a warning (below MAX, no pause). */
const GATE_QUEUE_WARN = e("GATE_QUEUE_WARN", 20);

/** Whether the gate is active. false = all sends bypass the gate. */
const GATE_ENABLED = eb("GATE_ENABLED", true);

/** ms before admin poll auto-discards the queue (10 min). */
const GATE_ADMIN_POLL_TIMEOUT_MS = e("GATE_ADMIN_POLL_TIMEOUT_MS", 10 * 60 * 1000);

// ── Catchup ──────────────────────────────────────────────────────────────────

/** ms to wait after WA ready event before starting catchup. */
const CATCHUP_DELAY_MS = e("CATCHUP_DELAY_MS", 2000);

/** Messages older than this (seconds) are skipped in catchup. 0 = no limit. */
const CATCHUP_MAX_AGE_SECS = e("CATCHUP_MAX_AGE_SECS", 300);

module.exports = {
  GATE_RATE_MS,
  GATE_BURST,
  GATE_QUEUE_MAX,
  GATE_QUEUE_WARN,
  GATE_ENABLED,
  GATE_ADMIN_POLL_TIMEOUT_MS,
  CATCHUP_DELAY_MS,
  CATCHUP_MAX_AGE_SECS,
};
