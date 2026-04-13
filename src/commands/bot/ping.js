module.exports = {
  name: "ping",
  description: "Responde com pong (teste de latência)",
  async execute(ctx) {
    // ctx: { message, reply, sender, client, services }
    if (typeof ctx.reply === 'function') {
      await ctx.reply("pong");
      return;
    }
    return "pong";
  },
};
