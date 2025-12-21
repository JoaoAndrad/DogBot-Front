const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');
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

function isProcessed(id) {
  ensureDir();
  const data = readJson(processedFile);
  return !!data[id];
}

function markProcessed(id) {
  ensureDir();
  const data = readJson(processedFile);
  data[id] = Date.now();
  writeJson(processedFile, data);
}

module.exports = { isProcessed, markProcessed };
