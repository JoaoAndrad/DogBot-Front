module.exports = async function defaultHandler(context) {
  const logger = require('../utils/logger');
  logger.debug('defaultHandler: message received', { body: context.info && context.info.body });
  // noop default
  return false;
};
