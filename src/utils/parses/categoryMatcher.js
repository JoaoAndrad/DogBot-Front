"use strict";

/**
 * Fuzzy category matcher — 3-layer matching strategy:
 *  1. Keyword exact token match  → highest confidence
 *  2. Substring / prefix match   → medium confidence
 *  3. Levenshtein distance ≤ 2   → lower confidence (typos)
 *
 * Input: a transaction description string (e.g. "uber", "smartfit", "psicólaga")
 * Output: { name: string, confidence: number } | null
 *
 * Confidence scale:
 *   1.00 = exact keyword match
 *   0.80 = substring match
 *   0.60 = Levenshtein ≤ 1
 *   0.45 = Levenshtein = 2
 *   null  = no match above threshold
 */

const { CATEGORY_INDEX } = require("./categoryKeywords");

const THRESHOLD = 0.4;

// Normalize: lowercase, remove accents, collapse spaces
function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokenize into words ≥ 2 chars
function tokenize(str) {
  return normalize(str).split(" ").filter((w) => w.length >= 2);
}

// Levenshtein distance between two strings
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Match a description against the known keyword index.
 * Optionally restrict to a whitelist of category names (the user's actual categories).
 *
 * @param {string} description - raw transaction description
 * @param {string[]} [allowedNames] - if provided, only match these category names
 * @returns {{ name: string, confidence: number } | null}
 */
function matchCategory(description, allowedNames = null) {
  if (!description) return null;

  const normDesc = normalize(description);
  const tokens = tokenize(description);

  const allowed = allowedNames
    ? new Set(allowedNames.map((n) => n.toLowerCase()))
    : null;

  let best = null;

  for (const entry of CATEGORY_INDEX) {
    if (allowed && !allowed.has(entry.name.toLowerCase())) continue;

    for (const kw of entry.keywords) {
      const normKw = normalize(kw);
      const kwTokens = normKw.split(" ").filter((w) => w.length >= 2);

      // Layer 1 — keyword exact token match
      // Every token of the keyword must appear in the description tokens
      const allMatch = kwTokens.every((kt) => tokens.includes(kt));
      if (allMatch) {
        const conf = 1.0;
        if (!best || conf > best.confidence) {
          best = { name: entry.name, confidence: conf };
        }
        break; // can't do better for this entry
      }

      // Layer 2 — substring: description contains the keyword (or vice-versa)
      if (normDesc.includes(normKw) || normKw.includes(normDesc)) {
        const conf = 0.8;
        if (!best || conf > best.confidence) {
          best = { name: entry.name, confidence: conf };
        }
        continue;
      }

      // Layer 3 — Levenshtein on individual tokens (only for tokens ≥ 5 chars)
      for (const dt of tokens) {
        if (dt.length < 5) continue;
        for (const kt of kwTokens) {
          if (kt.length < 5) continue;
          const dist = levenshtein(dt, kt);
          if (dist <= 1) {
            const conf = 0.6;
            if (!best || conf > best.confidence) {
              best = { name: entry.name, confidence: conf };
            }
          } else if (dist === 2) {
            const conf = 0.45;
            if (!best || conf > best.confidence) {
              best = { name: entry.name, confidence: conf };
            }
          }
        }
      }
    }
  }

  if (!best || best.confidence < THRESHOLD) return null;
  return best;
}

module.exports = { matchCategory, normalize, THRESHOLD };
