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
    bootLog.line("commands", {
      ok: true,
      ms: Date.now() - tCmd,
      extra: `keys=${commands.commands.size}`,
    });

    // commandPolicySync and bot startup are independent — run in parallel.
    // Commands are already loaded above, so the bot can start immediately.
    const tBot = Date.now();
    const [, botResult] = await Promise.allSettled([
      (async () => {
        try {
          const { syncRegisteredCommandsToBackend } = require("./services/commandPolicySync");
          const tSync = Date.now();
          const sync = await syncRegisteredCommandsToBackend(
            commands.listCommandsForPolicySync(),
          );
          bootLog.line("commandPolicySync", {
            ok: true,
            ms: Date.now() - tSync,
            extra: `created=${sync.created ?? 0} skipped=${sync.skipped ?? 0} removed=${sync.removed ?? 0}`,
          });
        } catch (err) {
          bootLog.line("commandPolicySync", {
            ok: false,
            ms: 0,
            extra: err && err.message ? String(err.message) : "sync failed",
          });
        }
      })(),
      BotService.start(),
    ]);

    if (botResult.status === "rejected") throw botResult.reason;

    bootLog.line("bot", {
      ok: true,
      ms: Date.now() - tBot,
      extra: "wa+polls+internal_api",
    });
    bootLog.separator("complete");
    // Keep process alive
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
