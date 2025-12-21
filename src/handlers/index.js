const logger = require('../utils/logger');
const commands = require('../commands');
const backendClient = require('../services/backendClient');
const spotifyService = require('../services/spotifyService');

async function handle(context) {
  // Accept either context.info (legacy) or context.msg (whatsapp-web.js)
  const info = context.info || {};
  const msg = context.msg || {};
  const body = String(info.body || msg.body || '').trim();
  const from = info.from || msg.from;
  // detect native poll creation messages (whatsapp-web.js MessageTypes.POLL_CREATION)
  try {
    const { MessageTypes } = require('whatsapp-web.js');
    if (msg && (msg.type === MessageTypes.POLL_CREATION || msg.type === 'poll_creation')) {
      // attempt to normalize poll data and save for fallback mapping
      const polls = require('../components/pool');
      const pollData = msg.poll || msg.pollCreation || msg.pollOptions || {};
      const title = pollData.pollName || pollData.title || body || 'Enquete';
      const options =
        pollData.pollOptions ||
        pollData.options ||
        (pollData.optionsList && pollData.optionsList.map(o => o.text)) ||
        [];
      const msgId = msg.id && (msg.id._serialized || msg.id.id || msg.id);
      if (msgId) {
        await require('../components/pool')
          .createPoll(context.client, from, title, options)
          .catch(() => {});
        // also save poll record directly if createPoll returned null or is unsupported
        const storage = require('../components/pool/storage');
        await storage.savePoll(msgId, {
          type: 'native',
          chatId: from,
          title,
          options,
          createdAt: Date.now(),
        });
      }
    }
  } catch (e) {
    // ignore if whatsapp-web.js not available or shape differs
  }

  logger.info('Mensagem recebida:', { from, body: body && body.slice(0, 120) });

  // prepare reply helper
  const reply = async text => {
    try {
      if (typeof msg.reply === 'function') return await msg.reply(text);
      if (context.client && from) return await context.client.sendMessage(from, text);
      return null;
    } catch (err) {
      logger.error('Erro ao enviar reply:', err);
    }
  };

  // detect command: prefix-based (! or /) or exact keyword fallback (e.g. 'ping')
  let isCommand = false;
  let cmdName = null;
  if (body.startsWith('!') || body.startsWith('/')) {
    isCommand = true;
    cmdName = body.slice(1).split(/\s+/)[0].toLowerCase();
  } else if (body.length && commands.commands.has(body.toLowerCase())) {
    isCommand = true;
    cmdName = body.toLowerCase();
  }

  if (isCommand && cmdName) {
    const cmd = commands.getCommand(cmdName);
    if (!cmd) {
      logger.debug('Comando não encontrado:', cmdName);
      await reply(`Comando desconhecido: ${cmdName}`);
      return;
    }

    const ctx = {
      message: msg,
      info,
      client: context.client,
      reply,
      services: { backend: backendClient, spotify: spotifyService },
    };

    try {
      await cmd.execute(ctx);
    } catch (err) {
      logger.error('Erro ao executar comando', cmdName, err);
      await reply('Ocorreu um erro ao executar o comando.');
    }

    return;
  }

  // fallback: numeric reply to vote for latest poll in this chat
  try {
    const numeric = body.match(/^\s*([1-9][0-9]*)\s*$/);
    if (numeric && from) {
      const idx = parseInt(numeric[1], 10) - 1;
      const pollStorage = require('../components/pool/storage');
      const pollsForChat = await pollStorage.findPollsByChat(from);
      if (pollsForChat && pollsForChat.length) {
        const latest = pollsForChat[0];
        const poll = latest.poll;
        const msgId = latest.id;
        const opts = poll.options || poll.optionsList || poll.optionsList || [];
        if (idx >= 0 && idx < opts.length) {
          const voterId = (msg && (msg.author || msg.from)) || String(from);
          await pollStorage.recordVote(msgId, voterId, [idx]);
          // invoke callback if registered
          try {
            const pollsModule = require('../components/pool');
            pollsModule.invokeCallback(msgId, {
              messageId: msgId,
              poll,
              voter: voterId,
              selectedIndexes: [idx],
              selectedNames: [(opts && opts[idx]) || String(idx)],
            });
          } catch (err) {
            logger.debug('Failed to invoke poll callback for numeric vote', err && err.message);
          }
          if (typeof reply === 'function') await reply(`Voto registrado: ${opts[idx]}`);
          return;
        }
      }
    }
  } catch (err) {
    // swallow fallback errors
    logger.debug('Erro ao processar fallback numérico de poll', err && err.message);
  }

  // legacy: simple static ping handler fallback
  if (body.toLowerCase() === 'ping') {
    try {
      await reply('pong');
    } catch (err) {
      logger.error('Erro ao enviar resposta:', err);
    }
  }
}

module.exports = { handle };
