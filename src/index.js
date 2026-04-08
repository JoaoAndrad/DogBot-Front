require("./utils/loadEnv").loadEnv();
const logger = require("./utils/logger");
const BotService = require("./bot");
const commands = require("./commands");

async function main() {
  console.log("Iniciando DogBot (frontend scaffold)");
  try {
    // load commands before starting the bot so handlers can dispatch them
    commands.loadCommands();
    console.log(
      "Commands carregados: " +
        commands
          .allCommands()
          .map((c) => c.name)
          .join(", ")
    );

    const bot = await BotService.start();
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
