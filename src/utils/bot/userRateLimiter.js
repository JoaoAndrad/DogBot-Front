/**
 * Limite de frequência em memória (janela deslizante por chave).
 * Ao exceder a janela, pode aplicar ban temporário (opts.banMs).
 */

/** @type {Map<string, number[]>} */
const buckets = new Map();
/** @type {Map<string, number>} — fim do ban (timestamp ms) */
const bans = new Map();

let sweepCounter = 0;
const SWEEP_EVERY = 200;

/**
 * @param {string} key — chave do bucket (contagem por tipo, ex.: cmd: / poll:)
 * @param {{ maxEvents: number, windowMs: number, banMs?: number, banKey?: string }} opts
 *        banKey — se definido, o ban temporário aplica-se a esta chave (ex.: rl:jid partilhado entre comandos e enquetes)
 * @returns {{ ok: true } | { ok: false, reason: 'banned' | 'limit_exceeded' }}
 */
function allow(key, opts) {
  const maxEvents = Number(opts.maxEvents);
  const windowMs = Number(opts.windowMs);
  const banMs = Number(opts.banMs ?? 0);
  const banKey =
    opts.banKey != null && String(opts.banKey).length > 0
      ? String(opts.banKey)
      : key;

  if (!key || !Number.isFinite(maxEvents) || maxEvents <= 0) return { ok: true };
  if (!Number.isFinite(windowMs) || windowMs <= 0) return { ok: true };

  const now = Date.now();

  const banUntil = bans.get(banKey);
  if (banUntil != null && banUntil > now) {
    return { ok: false, reason: "banned" };
  }
  if (banUntil != null && banUntil <= now) {
    bans.delete(banKey);
  }

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
    if (Number.isFinite(banMs) && banMs > 0) {
      bans.set(banKey, now + banMs);
      buckets.delete(key);
    }
    return { ok: false, reason: "limit_exceeded" };
  }

  stamps.push(now);
  sweepCounter += 1;
  if (sweepCounter >= SWEEP_EVERY) {
    sweepCounter = 0;
    sweepStale(now);
  }
  return { ok: true };
}

/**
 * Remove buckets e bans antigos/inativos.
 */
function sweepStale(now) {
  const maxAge = 24 * 60 * 60 * 1000; // 24 h
  const cutoff = now - maxAge;
  for (const [k, stamps] of buckets.entries()) {
    const kept = stamps.filter((t) => t >= cutoff);
    if (kept.length === 0) buckets.delete(k);
    else buckets.set(k, kept);
  }
  for (const [k, until] of bans.entries()) {
    if (until <= now) bans.delete(k);
  }
}

module.exports = { allow };
