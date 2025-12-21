require('dotenv').config();
const logger = require('./utils/logger');
const BotService = require('./bot');
const commands = require('./commands');

async function main() {
  logger.info('Iniciando DogBot (frontend scaffold)');
  try {
    // load commands before starting the bot so handlers can dispatch them
    commands.loadCommands();
    logger.info(
      'Commands carregados: ' +
        commands
          .allCommands()
          .map(c => c.name)
          .join(', ')
    );

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
