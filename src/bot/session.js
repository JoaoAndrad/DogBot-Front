const { LocalAuth } = require('whatsapp-web.js');
const path = require('path');

function initSessionOptions() {
  // Abstração para futuramente suportar outras estratégias (S3, DB, custom)
  // Salva sessão em <repo>/frontend/.wwebjs_auth independentemente do CWD
  const dataPath = path.join(__dirname, '..', '..', '.wwebjs_auth');
  return new LocalAuth({ clientId: 'dogbot', dataPath });
}

module.exports = { initSessionOptions };
