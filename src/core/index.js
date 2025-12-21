const logger = require('../utils/logger');
const config = require('./config');

async function start({ bot }) {
  logger.info('core: starting services');
  // start optional http server for health/metrics
  try {
    const server = require('./server');
    server.start(config.port);
  } catch (e) {
    logger.debug('core: server module missing or failed to start', e && e.message);
  }

  logger.info('core: started');
}

async function stop() {
  logger.info('core: stopping services');
}

module.exports = { start, stop };
