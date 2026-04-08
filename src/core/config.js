require("../utils/loadEnv").loadEnv();
module.exports = {
  port: process.env.PORT || 3000,
  botSecret: process.env.BOT_SECRET || "changeme",
  enableCatchup: process.env.ENABLE_CATCHUP !== "false",
  /** ms a esperar após "ready" antes do catchup (WA Web ainda a hidratar). 0 = sem espera. */
  catchupDelayMs: Math.max(
    0,
    parseInt(process.env.CATCHUP_DELAY_MS ?? "4000", 10) || 0,
  ),
};
