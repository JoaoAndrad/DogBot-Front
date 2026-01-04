const storage = require("../../components/poll/storage");
const logger = require("../../utils/logger");

module.exports = {
  name: "poll.results",
  description: "Mostrar resultados de enquete: !poll results <id|last>",
  async execute(ctx) {
    const body =
      (ctx.info && ctx.info.body) || (ctx.message && ctx.message.body) || "";
    const parts = body.split(/\s+/).slice(2);
    const arg = parts && parts.length ? parts[0] : "last";

    try {
      if (arg === "last") {
        const polls = await storage.findPollsByChat(
          ctx.info.from || ctx.message.from
        );
        if (!polls || !polls.length)
          return await ctx.reply("Nenhuma enquete encontrada neste chat.");
        const top = polls[0];
        const poll = top.poll;
        const counts = {};
        Object.values(poll.votes || {}).forEach((v) => {
          (v.selectedIndexes || []).forEach(
            (i) => (counts[i] = (counts[i] || 0) + 1)
          );
        });
        let text = `Resultados (última enquete): ${
          poll.title || poll.name || ""
        }\n\n`;
        const opts =
          (poll.pollOptions && poll.pollOptions.map((o) => o.name)) ||
          poll.options ||
          [];
        for (let i = 0; i < opts.length; i++)
          text += `${i + 1}) ${opts[i]} — ${counts[i] || 0}\n`;
        await ctx.reply(text);
        return;
      }

      // treat arg as id
      const poll = await storage.getPoll(arg);
      if (!poll) return await ctx.reply("Enquete não encontrada: " + arg);
      let text = `Resultados (id ${arg}): ${poll.title || poll.name || ""}\n\n`;
      const counts = {};
      Object.values(poll.votes || {}).forEach((v) => {
        (v.selectedIndexes || []).forEach(
          (i) => (counts[i] = (counts[i] || 0) + 1)
        );
      });
      const opts =
        (poll.pollOptions && poll.pollOptions.map((o) => o.name)) ||
        poll.options ||
        [];
      for (let i = 0; i < opts.length; i++)
        text += `${i + 1}) ${opts[i]} — ${counts[i] || 0}\n`;
      await ctx.reply(text);
    } catch (err) {
      console.log("poll.results error", err && err.message);
      await ctx.reply("Erro ao obter resultados.");
    }
  },
};
