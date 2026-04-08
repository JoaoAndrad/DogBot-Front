/**
 * Limite de frequência em memória (janela deslizante por chave).
 * Usado para anti-spam em mensagens e votos em enquetes.
 */

/** @type {Map<string, number[]>} */
const buckets = new Map();

let sweepCounter = 0;
const SWEEP_EVERY = 200;

/**
 * @param {string} key
 * @param {{ maxEvents: number, windowMs: number }} opts
 * @returns {boolean} true se o evento é permitido (e foi contado)
 */
function allow(key, opts) {
  const maxEvents = Number(opts.maxEvents);
  const windowMs = Number(opts.windowMs);
  if (!key || !Number.isFinite(maxEvents) || maxEvents <= 0) return true;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return true;

  const now = Date.now();
  const cutoff = now - windowMs;
  let stamps = buckets.get(key);
  if (!stamps) {
    stamps = [];
    buckets.set(key, stamps);
  } else {
    stamps = stamps.filter((t) => t >= cutoff);
    buckets.set(key, stamps);
  }

  if (stamps.length >= maxEvents) {
    return false;
  }

  stamps.push(now);
  sweepCounter += 1;
  if (sweepCounter >= SWEEP_EVERY) {
    sweepCounter = 0;
    sweepStale(now);
  }
  return true;
}

/**
 * Remove chaves sem timestamps recentes (usa o maior cutoff conservador).
 */
function sweepStale(now) {
  const maxAge = 24 * 60 * 60 * 1000; // 24 h — remove chaves inativas
  const cutoff = now - maxAge;
  for (const [k, stamps] of buckets.entries()) {
    const kept = stamps.filter((t) => t >= cutoff);
    if (kept.length === 0) buckets.delete(k);
    else buckets.set(k, kept);
  }
}

module.exports = { allow };
