require('dotenv').config();
module.exports = {
  port: process.env.PORT || 3000,
  botSecret: process.env.BOT_SECRET || 'changeme',
};
