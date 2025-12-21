const fetch = require('node-fetch');
const config = require('../core/config');

async function sendToBackend(path, body) {
  // placeholder: implement auth/BOT_SECRET header
  const url = process.env.BACKEND_URL || 'http://localhost:8000';
  const res = await fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': config.botSecret },
    body: JSON.stringify(body),
  });
  return res.json();
}

module.exports = { sendToBackend };
