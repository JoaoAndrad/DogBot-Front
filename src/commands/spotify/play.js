const logger = require("../../utils/logger");

module.exports = {
  name: 'spotify.play',
  description: 'Exemplo: iniciar reprodução no Spotify (placeholder)',
  async execute(ctx) {
    // Placeholder: integrate with `services.spotify` when available
    const reply = typeof ctx.reply === 'function' ? ctx.reply : text => logger.debug('[spotify.play]', text);
    await reply('Simulando: comando spotify.play recebido (placeholder)');
  },
};
