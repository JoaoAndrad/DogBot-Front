const logger = require("../utils/logger");
const middleware = require("./middleware");
const dedupe = require("./dedupe");

async function processEvent(context) {
  // middleware chain
  try {
    if (await dedupe.isDuplicate(context)) {
      console.log("pipeline: duplicate message, skipping");
      return false;
    }

    const ok = await middleware.run(context);
    if (!ok) return false;

    // delegate to handlers (handlers registry should be used)
    const handlers = require("../handlers");
    await handlers.handle(context);

    await dedupe.markProcessed(context);
    return true;
  } catch (err) {
    console.log("pipeline error", err);
    return false;
  }
}

module.exports = { processEvent };
