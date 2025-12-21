const logger = require('../utils/logger');

const middlewares = [];

function use(fn) {
  middlewares.push(fn);
}

async function run(context) {
  for (const mw of middlewares) {
    const ok = await mw(context);
    if (!ok) {
      logger.debug('middleware short-circuit');
      return false;
    }
  }
  return true;
}

module.exports = { use, run };
