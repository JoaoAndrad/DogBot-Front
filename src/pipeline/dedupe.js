const storage = require('../storage/jsonStore');

async function isDuplicate(context) {
  const msg = context.msg;
  const id = msg && msg.id && msg.id._serialized;
  if (!id) return false;
  return storage.isProcessed(id);
}

async function markProcessed(context) {
  const msg = context.msg;
  const id = msg && msg.id && msg.id._serialized;
  if (!id) return;
  storage.markProcessed(id);
}

module.exports = { isDuplicate, markProcessed };
