const backendClient = require("./backendClient");
const logger = require("../utils/logger");

/**
 * Mapa command_key -> { enabled, vipOnly }.
 * Sempre obtido com um GET ao backend (sem cache em memória).
 * null = falha de rede (fail-open no handler).
 */
async function getPoliciesMap() {
  try {
    const res = await backendClient.sendToBackend(
      "/api/bot/command-policies",
      null,
      "GET",
    );
    const map =
      res && res.policies && typeof res.policies === "object"
        ? res.policies
        : {};
    return map;
  } catch (err) {
    logger.warn(
      "[commandPolicy] falha ao carregar políticas (fail-open):",
      err && err.message,
    );
    return null;
  }
}

module.exports = {
  getPoliciesMap,
};
