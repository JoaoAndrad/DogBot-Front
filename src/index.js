require("./utils/bot/loadEnv").loadEnv();
const bootLog = require("./lib/bootLog");
const BotService = require("./bot");
const commands = require("./commands");

async function main() {
  bootLog.separator("start");
  try {
    const tCmd = Date.now();
    // load commands before starting the bot so handlers can dispatch them
    commands.loadCommands();
    const cmdMs = Date.now() - tCmd;
    const cmdCount = commands.listCanonicalCommandNames().length;

    // commandPolicySync and bot startup are independent — run in parallel.
    // Commands are already loaded above, so the bot can start immediately.
    const tBot = Date.now();
    const [syncResult, botResult] = await Promise.allSettled([
      (async () => {
        try {
          const { syncRegisteredCommandsToBackend } = require("./services/commandPolicySync");
          const sync = await syncRegisteredCommandsToBackend(
            commands.listCommandsForPolicySync(),
          );
          const syncExtra = sync.created > 0
            ? `${cmdCount} cmd  ·  DB +${sync.created}`
            : `${cmdCount} cmd  ·  DB ok`;
          bootLog.line("comandos", { ok: true, ms: cmdMs, extra: syncExtra });
          return sync;
        } catch (err) {
          bootLog.line("comandos", {
            ok: false,
            ms: cmdMs,
            extra: `${cmdCount} cmd  ·  sync falhou`,
          });
          throw err;
        }
      })(),
      BotService.start(),
    ]);

    if (botResult.status === "rejected") throw botResult.reason;

    bootLog.line("WhatsApp", {
      ok: true,
      ms: Date.now() - tBot,
      extra: "conectado",
    });
    // separator("complete") fires from bot/index.js ready handler once WA is truly ready
    process.on("SIGINT", async () => {
      console.log("SIGINT recebido, parando bot...");
      await BotService.stop();
      process.exit(0);
    });
  } catch (err) {
    console.log("Erro ao iniciar bot:", err);
    process.exit(1);
  }
}

main();
