require('dotenv').config();
const logger = require('./utils/logger');
const BotService = require('./bot');

async function main() {
  logger.info('Iniciando DogBot (frontend scaffold)');
  try {
    const bot = await BotService.start();
    // Keep process alive
    process.on('SIGINT', async () => {
      logger.info('SIGINT recebido, parando bot...');
      await BotService.stop();
      process.exit(0);
    });
  } catch (err) {
    logger.error('Erro ao iniciar bot:', err);
    process.exit(1);
  }
}

main();
