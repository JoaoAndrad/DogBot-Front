/**
 * Comandos cujo execute() abre um flow do flowManager (menu interactivo).
 * Actualizar quando adicionares um comando que só chame flowManager.startFlow.
 */
const FLOW_ENTRY_COMMAND_NAMES = new Set([
  "menu",
  "spotify",
  "rotina",
  "listas",
  "filme",
  "livro",
  "ajuda",
  "life360",
  "vinculo360",
]);

function isFlowEntryCommand(canonicalName) {
  return (
    typeof canonicalName === "string" &&
    FLOW_ENTRY_COMMAND_NAMES.has(canonicalName)
  );
}

module.exports = {
  FLOW_ENTRY_COMMAND_NAMES,
  isFlowEntryCommand,
};
