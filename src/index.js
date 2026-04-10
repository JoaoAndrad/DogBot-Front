require("./utils/loadEnv").loadEnv();
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

    const tBot = Date.now();
    await BotService.start();
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
