const backendClient = require("./backendClient");
const logger = require("../utils/logger");

/**
 * Envia a lista de comandos registados ao backend; cria linhas em falta
 * (enabled=true, vip_only=false) sem alterar as existentes.
 *
 * @param {string[]} commandKeys
 */
async function syncRegisteredCommandsToBackend(commandKeys) {
  const res = await backendClient.sendToBackend(
    "/api/bot/command-policies/sync",
    { commandKeys },
    "POST",
  );
  logger.info(
    `[commandPolicySync] políticas: created=${res.created ?? 0} skipped=${res.skipped ?? 0} invalid=${res.invalid ?? 0}`,
  );
  return res;
}

module.exports = { syncRegisteredCommandsToBackend };
