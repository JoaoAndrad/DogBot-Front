const logger = require('../../utils/logger');
const storage = require('./storage');
const builder = require('./builder');
const { createSender } = require('./sender');
const EventEmitter = require('events');
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

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

/**
 * Facade: build -> send -> persist -> register callback
 * Signature supports either passing a `client` as first arg (legacy) or an injected `sender` via opts.sender.
 * createPoll(clientOrSender, chatId, title, options, opts={})
 */
async function createPoll(clientOrSender, chatId, title, options, opts = {}) {
  // allow calling createPoll(chatId, title, options, opts) by shifting args if clientOrSender looks like chatId
  let sender = null;
  let effectiveChatId = chatId;
  if (typeof clientOrSender === 'string' && !chatId) {
    throw new Error('Invalid arguments: missing client/sender');
  }

  // If opts.sender provided, use it (DI)
  if (opts && opts.sender) sender = opts.sender;
  else if (clientOrSender && typeof clientOrSender.sendPoll === 'function') sender = clientOrSender;
  else if (clientOrSender && typeof clientOrSender.sendMessage === 'function')
    sender = createSender(clientOrSender);
  else throw new Error('No sender or client provided to createPoll');

  // Build payload (validates and normalizes)
  const payload = builder.buildPollPayload(chatId, title, options, opts);

  // Send
  const sendResult = await sender.sendPoll(payload, opts);
  if (!sendResult) {
    logger.warn('createPoll: sendResult null');
    return null;
  }

  const { msgId, sent, type, pollOptions } = sendResult;

  // persist
  const record = {
    type: type || 'native',
    chatId: payload.chatId,
    title: payload.title,
    options: payload.options,
    pollOptions: pollOptions || payload.options.map((o, i) => ({ name: o, localId: i })),
    optionsObj: payload.optionsObj || {},
    createdAt: Date.now(),
  };
  await storage.savePoll(msgId, record);

  // register callback
  if (typeof opts.onVote === 'function') callbacks.set(msgId, opts.onVote);

  logger.info('Poll enviada', { chatId: payload.chatId, msgId, title: payload.title });
  return { sent, msgId };
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
    const optsArr =
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
            const opt = optsArr && optsArr.find(o => o.localId === Number(lid));
            selectedNames.push(opt ? opt.name : name || String(lid));
          } else if (name) {
            const idx = optsArr && optsArr.findIndex(o => o.name === name);
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
        selectedNames = selectedIndexes.map(
          i => (optsArr && optsArr[i] && optsArr[i].name) || String(i)
        );
      }
    }

    await storage.recordVote(messageId, voter, rawSelected, selectedIndexes, selectedNames);

    const payload = {
      messageId,
      poll: storedPoll,
      voter,
      selectedIndexes,
      selectedNames,
      raw: vote,
    };

    // emit global and per-message events
    try {
      emitter.emit('vote', payload);
      emitter.emit(`vote:${messageId}`, payload);
    } catch (e) {
      logger.error('Erro ao emitir evento de vote', e);
    }

    const cb = callbacks.get(messageId);
    if (cb) {
      try {
        await cb(payload);
      } catch (err) {
        logger.error('Erro no callback de vote for poll', err);
      }
    }
  } catch (err) {
    logger.error('Erro ao handleVoteUpdate', err);
  }
}

function on(event, cb) {
  return emitter.on(event, cb);
}

function off(event, cb) {
  return emitter.off(event, cb);
}

function once(event, cb) {
  return emitter.once(event, cb);
}

module.exports = { createPoll, handleVoteUpdate, on, off, once };
module.exports.registerCallback = registerCallback;
module.exports.saveFallbackPoll = saveFallbackPoll;
module.exports.invokeCallback = invokeCallback;

/**
 * Convenience helper: ask a Yes/No question using native poll UI.
 * Signature mirrors `createPoll(clientOrSender, chatId, title, options, opts)`
 * Returns the same result as `createPoll` ({ sent, msgId }) or null on failure.
 */
async function askYesNo(clientOrSender, chatId, question, opts = {}) {
  const options = opts.options || ['Sim', 'Não'];
  const effectiveOpts = Object.assign({}, opts, { origin: opts.origin || 'askYesNo' });
  return createPoll(clientOrSender, chatId, question, options, effectiveOpts);
}

module.exports.askYesNo = askYesNo;
