const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');
const checkpointsFile = path.join(dataDir, 'checkpoints.json');
const processedFile = path.join(dataDir, 'processed.json');

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
  } catch (e) {
    return {};
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getLastTs(chatId) {
  ensureDir();
  const data = readJson(checkpointsFile);
  return data[chatId] || 0;
}

function setLastTs(chatId, ts) {
  ensureDir();
  const data = readJson(checkpointsFile);
  data[chatId] = Math.max(data[chatId] || 0, ts || 0);
  writeJson(checkpointsFile, data);
}

function isProcessed(msgId) {
  ensureDir();
  const data = readJson(processedFile);
  return !!data[msgId];
}

function markProcessed(msgId) {
  ensureDir();
  const data = readJson(processedFile);
  data[msgId] = Date.now();
  writeJson(processedFile, data);
}

module.exports = { getLastTs, setLastTs, isProcessed, markProcessed };
