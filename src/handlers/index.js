const logger = require('../utils/logger');

async function handle(context) {
  const { info } = context;
  logger.info('Handler recebido:', info);
  if (String(info.body).toLowerCase().trim() === 'ping') {
    try {
      await context.client.sendMessage(info.from, 'pong');
    } catch (err) {
      logger.error('Erro ao enviar resposta:', err);
    }
  }
}

module.exports = { handle };
