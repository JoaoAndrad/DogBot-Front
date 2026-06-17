const backendClient = require("./backendClient");
const logger = require("../utils/logger");

const TTL_MS = 60 * 1000;
const _cache = new Map(); // chatId -> { flags, ts }

const COMMAND_TYPE_TO_FEATURE = {
  spotify: "musica",
  worldcup: "copa",
  copa: "copa",
  cartola: "cartola",
  workout: "workout",
  confissao: "confissao",
  social: "confissao",
};

async function getFlagsForGroup(chatId) {
  const now = Date.now();
  const cached = _cache.get(chatId);
  if (cached && now - cached.ts < TTL_MS) return cached.flags;
  try {
    const res = await backendClient.sendToBackend(
      `/api/bot/group-feature-flags/${encodeURIComponent(chatId)}`,
      null,
      "GET",
    );
    const flags = res && res.flags && typeof res.flags === "object" ? res.flags : {};
    _cache.set(chatId, { flags, ts: now });
    return flags;
  } catch (err) {
    logger.warn("[groupFeatureFlag] falha ao carregar flags (fail-open):", err && err.message);
    return null;
  }
}

async function isCommandTypeAllowed(chatId, commandType) {
  if (!commandType) return true;
  const featureKey = COMMAND_TYPE_TO_FEATURE[commandType];
  if (!featureKey) return true;
  const flags = await getFlagsForGroup(chatId);
  if (!flags) return true; // fail-open
  return flags[featureKey] !== false;
}

module.exports = { getFlagsForGroup, isCommandTypeAllowed };
