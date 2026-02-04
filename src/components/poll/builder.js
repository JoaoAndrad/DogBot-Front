const logger = require("../../utils/logger");

function buildPollPayload(chatId, title, options, opts = {}) {
  if (!chatId) throw new Error("chatId is required");
  if (!title || typeof title !== "string") throw new Error("title is required");
  if (!Array.isArray(options) || options.length < 2)
    throw new Error("options must be an array with at least 2 items");

  const payload = {
    chatId,
    title: String(title).normalize("NFC"),
    options: options.map((o) => String(o).normalize("NFC")),
    optionsObj: opts.options || opts.pollOptions || {},
    meta: {
      createdAt: Date.now(),
      origin: opts.origin || "command",
    },
  };

  const isConfissaoPoll = title && /confiss[aã]o/i.test(title);

  if (!isConfissaoPoll) {
    console.log("pollBuilder: built payload", {
      chatId,
      title,
      optionsCount: payload.options.length,
    });
  }
  return payload;
}

module.exports = { buildPollPayload };
