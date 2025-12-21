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

  client = new Client({
    authStrategy: auth,
    puppeteer: { headless: true, args: ['--no-sandbox'] },
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
      const pipeline = require('./pipeline');
      await pipeline.processMessage({ client, msg });
    } catch (err) {
      logger.error('Erro ao processar mensagem:', err);
    }
  });

  await client.initialize();
  return client;
}

async function stop() {
  try {
    if (client) await client.destroy();
    logger.info('Client destruído');
  } catch (err) {
    logger.error('Erro ao parar client:', err);
  }
}

module.exports = { start, stop, client };
