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
  // Start a small internal HTTP API to trigger actions using the running client
  try {
    const http = require('http');
    const polls = require('../components/poll');
    const PORT = Number(process.env.INTERNAL_API_PORT || 3001);
    const server = http.createServer(async (req, res) => {
      try {
        const { method, url } = req;
        if (method === 'POST' && url === '/internal/send-poll') {
          let body = '';
          for await (const chunk of req) body += chunk;
          const data = JSON.parse(body || '{}');
          const chatId = data.chatId || data.to;
          const title = data.title || data.question || data.q;
          const options = Array.isArray(data.options)
            ? data.options
            : data.choices || data.opts || [];
          if (!chatId || !title || !options.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Missing chatId/title/options' }));
            return;
          }

          logger.info('Internal API: send-poll', { chatId, title, options });
          // try to create native poll via polls.createPoll which uses the existing client
          try {
            const result = await polls.createPoll(client, chatId, title, options, {
              onVote: async ({ messageId, poll, voter, selectedIndexes, selectedNames }) => {
                const opts =
                  poll && (poll.options || (poll.pollOptions && poll.pollOptions.map(o => o.name)));
                const chosen =
                  (selectedNames && selectedNames[0]) ||
                  (selectedIndexes &&
                    selectedIndexes[0] != null &&
                    opts &&
                    opts[selectedIndexes[0]]) ||
                  null;
                try {
                  if (chosen)
                    await client.sendMessage(chatId, `Voto registrado de ${voter}: ${chosen}`);
                } catch (e) {
                  logger.error('Internal onVote sendMessage failed', e && e.message);
                }
              },
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
          } catch (err) {
            const errMsg = err && (err.stack || err.message || String(err));
            logger.error('Internal API createPoll failed', errMsg);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: errMsg }));
          }
          return;
        }

        // unknown route
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
      } catch (err) {
        logger.error('Internal API handler error', err && err.message);
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        } catch (e) {}
      }
    });
    server.listen(PORT, '127.0.0.1', () =>
      logger.info('Internal API listening on http://127.0.0.1:' + PORT)
    );
  } catch (e) {
    logger.warn('Internal API failed to start (non-fatal)', e && e.message);
  }
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
