/**
 * MessageGate — token bucket + FIFO queue for all outgoing WhatsApp replies.
 *
 * Prevents burst sends (ban risk). Real-time replies go through the gate;
 * catchup replies bypass it (already rate-limited by the 150ms delay in catchup.js).
 *
 * When the queue reaches GATE_QUEUE_MAX the gate pauses and calls the
 * registered `onQueueFull` callback. That callback (set up in bot/index.js)
 * sends an admin poll and eventually calls gate.resume() or gate.clearAndResume().
 *
 * Constants come from src/constants.js (override via env vars if needed).
 */

const logger = require("../utils/logger");
const {
  GATE_ENABLED,
  GATE_RATE_MS,
  GATE_BURST,
  GATE_QUEUE_MAX,
  GATE_QUEUE_WARN,
} = require("../constants");

// ── state ─────────────────────────────────────────────────────────────────────

let _client = null;
let _paused = false;
let _waitingForAdmin = false;
let _onQueueFull = null;
let _tokens = GATE_BURST;
let _lastRefill = Date.now();
let _workerPromise = null;

/** @type {Array<{sendFn: () => Promise<any>, resolve: Function, reject: Function}>} */
const _queue = [];

// ── token bucket ──────────────────────────────────────────────────────────────

function _refillTokens() {
  const now = Date.now();
  const add = Math.floor((now - _lastRefill) / GATE_RATE_MS);
  if (add > 0) {
    _tokens = Math.min(GATE_BURST, _tokens + add);
    _lastRefill += add * GATE_RATE_MS;
  }
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── worker ────────────────────────────────────────────────────────────────────

async function _workerLoop() {
  while (_queue.length > 0) {
    if (_paused) {
      await _sleep(200);
      continue;
    }

    _refillTokens();

    if (_tokens <= 0) {
      const waitMs = GATE_RATE_MS - (Date.now() - _lastRefill);
      await _sleep(Math.max(10, waitMs));
      continue;
    }

    const item = _queue.shift();
    if (!item) continue;

    _tokens--;

    try {
      const result = await item.sendFn();
      item.resolve(result);
    } catch (err) {
      logger.warn("[MessageGate] falha ao enviar mensagem:", err && err.message);
      item.reject(err);
    }
  }
}

function _ensureWorker() {
  if (_workerPromise) return;
  _workerPromise = _workerLoop().finally(() => {
    _workerPromise = null;
  });
  _workerPromise.catch((err) => {
    logger.error("[MessageGate] worker crash:", err && err.message);
    _workerPromise = null;
  });
}

// ── queue full handling ───────────────────────────────────────────────────────

function _handleQueueFull() {
  if (_waitingForAdmin) return; // poll already pending
  _waitingForAdmin = true;
  _paused = true;
  logger.warn(
    `[MessageGate] fila cheia (${_queue.length}/${GATE_QUEUE_MAX}) — pausado, aguardando decisão do admin`,
  );

  if (typeof _onQueueFull === "function") {
    Promise.resolve()
      .then(() => _onQueueFull({ queueLength: _queue.length }))
      .catch((err) => {
        logger.error("[MessageGate] onQueueFull error:", err && err.message);
        // Safety fallback: discard and resume so the gate doesn't stay locked forever
        clearAndResume();
      });
  } else {
    // No callback registered — discard and resume automatically
    logger.warn("[MessageGate] nenhum onQueueFull registado — descartando fila");
    clearAndResume();
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the gate.
 * @param {object} client    WA client instance
 * @param {object} [opts]
 * @param {(stats: {queueLength: number}) => void} [opts.onQueueFull]
 *   Called when queue reaches GATE_QUEUE_MAX. Must eventually call
 *   gate.resume() or gate.clearAndResume().
 */
function init(client, opts = {}) {
  _client = client;
  _onQueueFull = opts.onQueueFull || null;
  _tokens = GATE_BURST;
  _lastRefill = Date.now();
  _paused = false;
  _waitingForAdmin = false;
  logger.info(
    `[MessageGate] iniciado — enabled=${GATE_ENABLED} rate=${GATE_RATE_MS}ms burst=${GATE_BURST} qmax=${GATE_QUEUE_MAX} qwarn=${GATE_QUEUE_WARN}`,
  );
}

/**
 * Enqueue a send operation through the gate.
 * @param {() => Promise<any>} sendFn  Zero-arg function that performs the actual WA send.
 * @returns {Promise<any>}             Resolves with the WA Message when actually sent.
 */
function enqueue(sendFn) {
  if (!GATE_ENABLED) {
    return sendFn().catch((err) => {
      logger.error("[MessageGate] erro (gate desabilitada):", err && err.message);
      return null;
    });
  }

  if (_queue.length >= GATE_QUEUE_MAX) {
    _handleQueueFull();
    // Drop this message (queue is full)
    return Promise.resolve(null);
  }

  if (_queue.length >= GATE_QUEUE_WARN) {
    logger.warn(`[MessageGate] fila grande: ${_queue.length + 1}/${GATE_QUEUE_MAX}`);
  }

  return new Promise((resolve, reject) => {
    _queue.push({ sendFn, resolve, reject });
    _ensureWorker();
  });
}

/**
 * Resume the gate worker (after admin voted "Sim" or timeout).
 * Drains the existing queue normally.
 */
function resume() {
  _paused = false;
  _waitingForAdmin = false;
  logger.info(`[MessageGate] retomado — ${_queue.length} mensagens na fila`);
  _ensureWorker();
}

/**
 * Discard all queued messages and resume the gate (after admin voted "Não" or timeout).
 */
function clearAndResume() {
  const count = _queue.length;
  // Resolve all pending with null (silent discard — callers won't hang)
  while (_queue.length > 0) {
    const item = _queue.shift();
    if (item) item.resolve(null);
  }
  _paused = false;
  _waitingForAdmin = false;
  logger.info(`[MessageGate] fila limpa (${count} mensagens descartadas) — retomado`);
}

/** Pause the gate manually (messages enqueue but are not sent). */
function pause() {
  _paused = true;
  logger.info("[MessageGate] pausado manualmente");
}

/** Current gate statistics. */
function getStats() {
  return {
    enabled: GATE_ENABLED,
    paused: _paused,
    waitingForAdmin: _waitingForAdmin,
    queueLength: _queue.length,
    tokens: _tokens,
  };
}

module.exports = { init, enqueue, resume, clearAndResume, pause, getStats };
