const polls = require('../../components/poll');
const logger = require('../../utils/logger');

module.exports = {
  name: 'poll',
  description: 'Criar enquete: !poll Título | Opção1 | Opção2 | ...',
  async execute(ctx) {
    const body = (ctx.info && ctx.info.body) || (ctx.message && ctx.message.body) || '';
    const args = body
      .replace(/^(!|\/)poll\s+/i, '')
      .split('|')
      .map(s => s.trim())
      .filter(Boolean);
    if (args.length < 2) {
      if (typeof ctx.reply === 'function')
        await ctx.reply('Uso: !poll Título | Opção1 | Opção2 (mínimo 2 opções)');
      return;
    }

    const title = args.shift();
    const options = args;

    const chatTarget =
      (ctx && ctx.info && ctx.info.from) ||
      (ctx && ctx.message && ctx.message.from) ||
      (ctx && ctx.chat && ctx.chat.id && ctx.chat.id._serialized) ||
      (ctx && ctx.from) ||
      'unknown';

    try {
      // delegate validation/orchestration to createPoll (build -> send -> persist)
      const res = await polls.createPoll(ctx.client, chatTarget, title, options, {
        onVote: async ({ messageId, poll, voter, selectedIndexes, selectedNames }) => {
          const opts =
            poll && (poll.options || (poll.pollOptions && poll.pollOptions.map(o => o.name)));
          const chosen =
            (selectedNames && selectedNames[0]) ||
            (selectedIndexes && selectedIndexes[0] != null && opts && opts[selectedIndexes[0]]) ||
            null;
          try {
            if (chosen) {
              if (typeof ctx.reply === 'function') {
                await ctx.reply(`Voto registrado de ${voter}: ${chosen}`);
              } else if (ctx.client && chatTarget) {
                await ctx.client.sendMessage(chatTarget, `Voto registrado de ${voter}: ${chosen}`);
              }
            }
          } catch (cbErr) {
            logger.error('poll onVote callback error', cbErr && cbErr.message);
          }
        },
      });

      if (res && res.msgId) {
        if (typeof ctx.reply === 'function') await ctx.reply('Enquete criada. ID: ' + res.msgId);
        else if (ctx.client && chatTarget)
          await ctx.client.sendMessage(chatTarget, 'Enquete criada.');
        return;
      }

      // no text fallback: log and inform minimal failure
      logger.error('createPoll returned null — poll not sent', { chatTarget, title, options });
      if (typeof ctx.reply === 'function') await ctx.reply('Falha ao criar enquete (ver logs)');
    } catch (err) {
      logger.error('Error creating native poll:', err && (err.message || err));
      if (typeof ctx.reply === 'function') await ctx.reply('Erro ao criar enquete (ver logs)');
    }
  },
};
