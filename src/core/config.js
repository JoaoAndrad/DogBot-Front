require("../utils/loadEnv").loadEnv();

function intEnv(name, defaultVal) {
  const n = parseInt(process.env[name] ?? String(defaultVal), 10);
  return Number.isFinite(n) && n >= 0 ? n : defaultVal;
}

module.exports = {
  port: process.env.PORT || 3000,
  botSecret: process.env.BOT_SECRET || "changeme",
  enableCatchup: process.env.ENABLE_CATCHUP !== "false",
  /** ms a esperar após "ready" antes do catchup (WA Web ainda a hidratar). 0 = sem espera. */
  catchupDelayMs: Math.max(
    0,
    parseInt(process.env.CATCHUP_DELAY_MS ?? "4000", 10) || 0,
  ),

  /** Rate limiting (frontend): desligar com RATE_LIMIT_ENABLED=false */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== "false",
  /** Máx. de mensagens por utilizador por janela (pipeline) — defaults baixos para não parecer automatização */
  rateLimitMsgMax: intEnv("RATE_LIMIT_MSG_MAX", 12),
  rateLimitMsgWindowMs: intEnv("RATE_LIMIT_MSG_WINDOW_MS", 60_000),
  /** Máx. de votos em enquete por utilizador por janela — cliques rápidos em poll são sensíveis */
  rateLimitPollVoteMax: intEnv("RATE_LIMIT_POLL_VOTE_MAX", 6),
  rateLimitPollVoteWindowMs: intEnv("RATE_LIMIT_POLL_VOTE_WINDOW_MS", 60_000),
  /** Ban (ms) ao exceder limite de mensagens ou de votos — default 10 min */
  rateLimitBanMs: intEnv("RATE_LIMIT_BAN_MS", 10 * 60 * 1000),
};
