module.exports = async function defaultHandler(context) {
  const logger = require("../utils/logger");
  logger.debug("defaultHandler: mensagem recebida", {
    body: context.info && context.info.body,
  });
  // noop default
  return false;
};
