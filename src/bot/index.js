const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const { Client } = require('whatsapp-web.js');
const logger = require('../utils/logger');
const { initSessionOptions } = require('./session');
const qrHelper = require('./qr');

let client = null;

async function start() {
  const auth = initSessionOptions();

  // By default run Puppeteer in headless mode (do not show the browser).
  // To explicitly show the browser set PUPPETEER_HEADLESS=false in env.
  const headless = process.env.PUPPETEER_HEADLESS !== 'false';
  const puppeteerOpts = { headless: headless, args: ['--no-sandbox'] };
  // Only add UI-related flags when not headless
  if (!headless) puppeteerOpts.args.push('--start-maximized');

  client = new Client({
    authStrategy: auth,
    puppeteer: puppeteerOpts,
  });

  client.on('qr', qr => {
    qrHelper
      .saveQr(qr)
      .then(p => {
        logger.info('QR salvo em ' + p);
      })
      .catch(err => {
        logger.error('Erro ao salvar QR:', err);
      });
  });

  client.on('ready', async () => {
    logger.info('WhatsApp client pronto');
    try {
      const catchup = require('./catchup');
      // Rodar catchup ao iniciar para processar mensagens recebidas enquanto offline
      await catchup.runCatchup(client, { limitPerChat: 200 });
    } catch (err) {
      // Log completo para diagnóstico
      logger.warn('Erro no catchup inicial:', {
        message: err && err.message,
        stack: err && err.stack,
        error: err,
      });
    }
  });

  client.on('message', async msg => {
    try {
      const pipeline = require('../pipeline');
      await pipeline.processEvent({ client, msg });
    } catch (err) {
      logger.error('Erro ao processar mensagem:', err);
    }
  });

  // listen for poll votes (vote_update) and dispatch to polls handler
  try {
    const polls = require('../components/poll');
    client.on('vote_update', async vote => {
      try {
        await polls.handleVoteUpdate(vote);
      } catch (err) {
        logger.error('Erro ao processar vote_update:', err);
      }
    });
  } catch (err) {
    logger.warn('Módulo polls não encontrado; vote_update não será processado');
  }

  await client.initialize();
  // Start the internal API (delegated to separate module)
  try {
    const { startInternalApi } = require('./internal-api');
    await startInternalApi(client);
  } catch (e) {
    logger.warn('Internal API failed to start (non-fatal)', e && e.message);
  }
  return client;
}

async function stop() {
  try {
    // stop internal API if running
    try {
      const { stopInternalApi } = require('./internal-api');
      await stopInternalApi();
    } catch (e) {}
    if (client) await client.destroy();
    logger.info('Client destruído');
  } catch (err) {
    logger.error('Erro ao parar client:', err);
  }
}

module.exports = { start, stop, client };
