const { Poll } = require('whatsapp-web.js');
console.log('Poll:', Poll);
console.log('typeof Poll:', typeof Poll);
try {
  if (Poll) {
    console.log('Poll prototype keys:', Object.getOwnPropertyNames(Poll.prototype || {}));
    console.log('Poll keys:', Object.keys(Poll));
  }
} catch (e) {
  console.error('Error inspecting Poll:', e);
}

// Exit so `node` run finishes quickly
process.exit(0);
