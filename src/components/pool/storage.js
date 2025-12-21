const fs = require('fs').promises;
const path = require('path');

// moved deeper: data is at src/data/polls.json
const FILE = path.join(__dirname, '..', '..', 'data', 'polls.json');

async function _read() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function _write(obj) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(obj, null, 2), 'utf8');
}

async function savePoll(msgId, poll) {
  const store = await _read();
  store[msgId] = poll;
  await _write(store);
}

async function getPoll(msgId) {
  const store = await _read();
  return store[msgId] || null;
}

async function listPolls() {
  const store = await _read();
  return Object.entries(store).map(([id, p]) => ({ id, poll: p }));
}

async function findPollsByChat(chatId) {
  const all = await listPolls();
  return all
    .filter(x => x.poll && x.poll.chatId === chatId)
    .sort((a, b) => (b.poll.createdAt || 0) - (a.poll.createdAt || 0));
}

async function removePoll(msgId) {
  const store = await _read();
  if (store[msgId]) delete store[msgId];
  await _write(store);
}

async function recordVote(msgId, voterId, selectedOptions) {
  const poll = await getPoll(msgId);
  if (!poll) return null;
  poll.votes = poll.votes || {};
  let selectedIndexes = [];
  let selectedNames = [];
  const opts =
    poll.pollOptions || (poll.options && poll.options.map((o, i) => ({ name: o, localId: i })));
  if (Array.isArray(selectedOptions) && selectedOptions.length) {
    if (typeof selectedOptions[0] === 'object') {
      for (const s of selectedOptions) {
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
      selectedIndexes = selectedOptions.map(n => Number(n));
      selectedNames = selectedIndexes.map(i => (opts && opts[i] && opts[i].name) || String(i));
    }
  }

  poll.votes[voterId] = {
    selectedOptionsRaw: selectedOptions,
    selectedIndexes,
    selectedNames,
    ts: Date.now(),
  };
  await savePoll(msgId, poll);
  return poll;
}

module.exports = { savePoll, getPoll, removePoll, recordVote, listPolls, findPollsByChat };
