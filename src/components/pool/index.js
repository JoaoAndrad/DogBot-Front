const { Poll } = require('whatsapp-web.js');
const logger = require('../../utils/logger');
const storage = require('./storage');

// in-memory callbacks map: messageId -> callback
const callbacks = new Map();

function registerCallback(msgId, cb) {
  if (!msgId || typeof cb !== 'function') return false;
  callbacks.set(msgId, cb);
  return true;
}

async function saveFallbackPoll(chatId, title, options, opts = {}) {
  const msgId = `fallback_${Date.now()}`;
  const normTitle = title && String(title).normalize ? String(title).normalize('NFC') : title;
  const normOptions = Array.isArray(options)
    ? options.map(o => (o && String(o).normalize ? String(o).normalize('NFC') : o))
    : [];
  const record = {
    type: 'fallback',
    chatId,
    title: normTitle,
    options: normOptions.slice(),
    pollOptions: normOptions.map((o, i) => ({ name: o, localId: i })),
    optionsObj: opts.options || {},
    createdAt: Date.now(),
  };
  await storage.savePoll(msgId, record);
  return msgId;
}

function invokeCallback(msgId, data) {
  const cb = callbacks.get(msgId);
  if (cb) {
    try {
      cb(data);
    } catch (err) {
      logger.error('Error invoking poll callback', err);
    }
  }
}

async function createPoll(client, chatId, title, options, opts = {}) {
  if (!Array.isArray(options) || options.length < 2)
    throw new Error('Poll requires at least 2 options');

  // normalize strings to NFC to avoid mojibake when sending/storing
  const normTitle =
    title && String(title).normalize ? String(title).normalize('NFC') : String(title);
  const normOptions = Array.isArray(options)
    ? options.map(o => (o && String(o).normalize ? String(o).normalize('NFC') : String(o)))
    : options;

  if (typeof Poll !== 'function') {
    logger.debug('Native Poll not available in runtime');
    return null;
  }

  try {
    try {
      if (client && client.interface && typeof client.interface.openChatWindow === 'function') {
        await client.interface.openChatWindow(chatId).catch(() => {});
        await new Promise(r => setTimeout(r, 1200));
      }
    } catch (e) {
      logger.debug('openChatWindow failed (non-fatal)', e && (e.message || e.stack));
    }

    const pollOptions = normOptions.map((o, i) => ({ name: o, localId: i }));
    const optionsObj = opts.options || opts.pollOptions || {};
    const poll = new Poll(normTitle, pollOptions, optionsObj);
    const sent = await client.sendMessage(chatId, poll);
    const msgId = sent && sent.id && sent.id._serialized ? sent.id._serialized : sent.id;
    const record = {
      type: 'native',
      chatId,
      title: normTitle,
      options: normOptions,
      pollOptions: pollOptions,
      optionsObj: optionsObj,
      createdAt: Date.now(),
    };
    await storage.savePoll(msgId, record);

    if (typeof opts.onVote === 'function') callbacks.set(msgId, opts.onVote);

    logger.info('Poll enviada', { chatId, msgId, title });
    return { sent, msgId };
  } catch (err) {
    logger.warn(
      'Falha ao enviar Poll nativo (primeira tentativa)',
      err && (err.stack || err.message || err)
    );

    try {
      const altPoll = new Poll(normTitle, normOptions, opts.options || opts.pollOptions || {});
      const sent2 = await client.sendMessage(chatId, altPoll);
      const msgId2 = sent2 && sent2.id && sent2.id._serialized ? sent2.id._serialized : sent2.id;
      const record2 = {
        type: 'native-alt',
        chatId,
        title: normTitle,
        options: normOptions,
        pollOptions: normOptions.map((o, i) => ({ name: o, localId: i })),
        optionsObj: opts.options || opts.pollOptions || {},
        createdAt: Date.now(),
      };
      await storage.savePoll(msgId2, record2);
      if (typeof opts.onVote === 'function') callbacks.set(msgId2, opts.onVote);
      logger.info('Poll enviada (segunda tentativa com strings)', { chatId, msgId: msgId2, title });
      return { sent: sent2, msgId: msgId2 };
    } catch (err2) {
      logger.warn(
        'Falha ao enviar Poll nativo (segunda tentativa)',
        err2 && (err2.stack || err2.message || err2)
      );
      return null;
    }
  }
}

async function handleVoteUpdate(vote) {
  try {
    logger.info(
      'vote_update recebido',
      vote && (vote.messageId || vote.parentMsgKey || vote.message?.id || 'no-id')
    );
    let messageId = null;
    if (vote.messageId) messageId = vote.messageId;
    else if (vote.parentMsgKey && vote.parentMsgKey._serialized)
      messageId = vote.parentMsgKey._serialized;
    else if (vote.parentMsgKey && vote.parentMsgKey.id) messageId = vote.parentMsgKey.id;
    else if (vote.message && vote.message.id) messageId = vote.message.id;
    else if (vote.message && vote.message._serialized) messageId = vote.message._serialized;
    if (!messageId) {
      logger.debug('vote_update sem messageId — ignorando');
      return;
    }

    const poll = await storage.getPoll(messageId);
    if (!poll) {
      logger.debug('vote_update para enquete desconhecida', messageId);
      return;
    }

    const voter =
      vote.voter ||
      vote.voterId ||
      (vote.author && vote.author.id) ||
      (vote.voter && vote.voter._serialized) ||
      'unknown';
    const selectedOptions =
      vote.selectedOptions || vote.selected || vote.selectedOptionIndexes || [];

    let rawSelected = selectedOptions;
    let selectedIndexes = [];
    let selectedNames = [];
    const storedPoll = poll || (await storage.getPoll(messageId));
    const opts =
      storedPoll &&
      (storedPoll.pollOptions ||
        (storedPoll.options && storedPoll.options.map((o, i) => ({ name: o, localId: i }))));

    if (Array.isArray(rawSelected) && rawSelected.length) {
      if (typeof rawSelected[0] === 'object') {
        for (const s of rawSelected) {
          const lid = s.localId != null ? s.localId : s.local_id || null;
          const name = s.name || s.option || null;
          if (lid != null) {
            selectedIndexes.push(Number(lid));
            const opt = opts && opts.find(o => o.localId === Number(lid));
            selectedNames.push(opt ? opt.name : name || String(lid));
          } else if (name) {
            const idx = opts && opts.findIndex(o => o.name === name);
            if (idx != null && idx >= 0) {
              selectedIndexes.push(idx);
              selectedNames.push(name);
            } else {
              selectedNames.push(name);
            }
          }
        }
      } else {
        selectedIndexes = rawSelected.map(n => Number(n));
        selectedNames = selectedIndexes.map(i => (opts && opts[i] && opts[i].name) || String(i));
      }
    }

    await storage.recordVote(messageId, voter, rawSelected);

    const cb = callbacks.get(messageId);
    if (cb) {
      try {
        await cb({ messageId, poll: storedPoll, voter, selectedIndexes, selectedNames, raw: vote });
      } catch (err) {
        logger.error('Erro no callback de vote for poll', err);
      }
    }
  } catch (err) {
    logger.error('Erro ao handleVoteUpdate', err);
  }
}

module.exports = { createPoll, handleVoteUpdate };
module.exports.registerCallback = registerCallback;
module.exports.saveFallbackPoll = saveFallbackPoll;
module.exports.invokeCallback = invokeCallback;
