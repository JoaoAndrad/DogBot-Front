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
  return res;
}

/**
 * Envia opções de flow ao backend para criação de políticas em falta.
 * Nunca altera enabled/vip_only/admin_only já existentes.
 *
 * @param {Array<{ flowId, optionKey, label, nodePath }>} options
 */
async function syncFlowOptionsToBackend(options) {
  try {
    const res = await backendClient.sendToBackend(
      "/api/bot/flow-option-policies/sync",
      { options },
      "POST",
    );
    return res;
  } catch (err) {
    logger.warn("[commandPolicySync] falha ao sincronizar flow options:", err && err.message);
    return null;
  }
}

module.exports = { syncRegisteredCommandsToBackend, syncFlowOptionsToBackend };
