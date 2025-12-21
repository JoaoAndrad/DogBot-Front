const { Poll } = require('whatsapp-web.js');
const logger = require('../../utils/logger');

function createSender(client) {
  if (!client) throw new Error('client is required to create sender');

  async function _openChatIfNeeded(chatId) {
    try {
      if (client.interface && typeof client.interface.openChatWindow === 'function') {
        await client.interface.openChatWindow(chatId).catch(() => {});
        await new Promise(r => setTimeout(r, 1200));
      }
    } catch (e) {
      logger.debug('openChatWindow failed (non-fatal)', e && (e.message || e.stack));
    }
  }

  async function sendPoll(payload, opts = {}) {
    if (!payload || !payload.chatId) throw new Error('payload.chatId is required');
    const { chatId, title, options, optionsObj } = payload;

    if (typeof Poll !== 'function') {
      logger.debug('Native Poll not available in runtime');
      return null;
    }

    const pollOptions = Array.isArray(options)
      ? options.map((o, i) => ({ name: o, localId: i }))
      : [];

    try {
      await _openChatIfNeeded(chatId);

      const poll = new Poll(title, pollOptions, optionsObj || {});
      const sent = await client.sendMessage(chatId, poll);
      const msgId = sent && sent.id && sent.id._serialized ? sent.id._serialized : sent.id;
      return { sent, msgId, type: 'native', pollOptions };
    } catch (err) {
      logger.warn(
        'Failed to send native poll (first attempt)',
        err && (err.stack || err.message || err)
      );
      try {
        // second attempt with alternate construction
        const altPoll = new Poll(title, options, optionsObj || {});
        const sent2 = await client.sendMessage(chatId, altPoll);
        const msgId2 = sent2 && sent2.id && sent2.id._serialized ? sent2.id._serialized : sent2.id;
        return {
          sent: sent2,
          msgId: msgId2,
          type: 'native-alt',
          pollOptions: options.map((o, i) => ({ name: o, localId: i })),
        };
      } catch (err2) {
        logger.warn(
          'Failed to send native poll (second attempt)',
          err2 && (err2.stack || err2.message || err2)
        );
        return null;
      }
    }
  }

  return { sendPoll };
}

module.exports = { createSender };
