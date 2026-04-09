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
  /** Máx. de comandos por utilizador por janela (só / ou ! ou confissao em DM) — evita rajadas */
  rateLimitCmdMax: intEnv("RATE_LIMIT_CMD_MAX", 3),
  rateLimitCmdWindowMs: intEnv("RATE_LIMIT_CMD_WINDOW_MS", 5_000),
  /** Máx. de interações com enquetes de voto único por utilizador por janela — default 5 em 10s (enquetes com allowMultipleAnswers não usam este limite) */
  rateLimitPollVoteMax: intEnv("RATE_LIMIT_POLL_VOTE_MAX", 3),
  rateLimitPollVoteWindowMs: intEnv("RATE_LIMIT_POLL_VOTE_WINDOW_MS", 5_000),
  /** Ban (ms) ao exceder limite de comandos ou de votos em enquetes */
  rateLimitBanMs: intEnv("RATE_LIMIT_BAN_MS", 5 * 60 * 1000),
};
