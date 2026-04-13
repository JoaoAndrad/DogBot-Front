const backendClient = require("./backendClient");
const logger = require("../utils/logger");

/**
 * Envia comandos (nome + pasta/tipo) ao backend; cria linhas em falta
 * (enabled=true, vip_only=false). Actualiza `command_type` se a pasta mudar.
 *
 * @param {Array<{ commandKey: string, commandType: string, isFlowEntry?: boolean }>} commands
 */
async function syncRegisteredCommandsToBackend(commands) {
  const res = await backendClient.sendToBackend(
    "/api/bot/command-policies/sync",
    { commands },
    "POST",
  );
  logger.info(
    `[commandPolicySync] políticas: created=${res.created ?? 0} skipped=${res.skipped ?? 0} removed=${res.removed ?? 0} typesUpdated=${res.commandTypesUpdated ?? 0} flowEntryUpdated=${res.flowEntryUpdated ?? 0} invalid=${res.invalid ?? 0}`,
  );
  return res;
}

module.exports = { syncRegisteredCommandsToBackend };
