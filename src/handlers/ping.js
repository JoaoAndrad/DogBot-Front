module.exports = async function pingHandler(context) {
  const { info, client } = context;
  if (
    String(info.body || '')
      .trim()
      .toLowerCase() === 'ping'
  ) {
    try {
      await client.sendMessage(info.from, 'pong');
      return true;
    } catch (e) {
      const logger = require('../utils/logger');
      logger.error('ping handler failed', e);
      return false;
    }
  }
  return false;
};
