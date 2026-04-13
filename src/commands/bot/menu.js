const flowManager = require("../../components/menu/flowManager");
const testFlow = require("../../components/menu/flows/testFlow");
const spotifyFlow = require("../../components/menu/flows/spotifyFlow");
const listsFlow = require("../../components/menu/flows/listsFlow");
const addFilmFlow = require("../../components/menu/flows/addFilmFlow");
const filmCardFlow = require("../../components/menu/flows/filmCardFlow");
const filmSearchFlow = require("../../components/menu/flows/filmSearchFlow");
const bookCardFlow = require("../../components/menu/flows/bookCardFlow");
const bookSearchFlow = require("../../components/menu/flows/bookSearchFlow");
const addBookFlow = require("../../components/menu/flows/addBookFlow");
const movieFlow = require("../../components/menu/flows/movieFlow");
const bookFlow = require("../../components/menu/flows/bookFlow");
const rotinaFlow = require("../../components/menu/flows/rotinaFlow");
const life360Flow = require("../../components/menu/flows/life360Flow");
const vinculo360Flow = require("../../components/menu/flows/vinculo360Flow");
const ajudaFlow = require("../../components/menu/flows/ajudaFlow");

// Register flows on load
flowManager.registerFlow(testFlow);
flowManager.registerFlow(spotifyFlow);
flowManager.registerFlow(listsFlow);
flowManager.registerFlow(movieFlow);
flowManager.registerFlow(bookFlow);
flowManager.registerFlow(addFilmFlow);
flowManager.registerFlow(addBookFlow);
flowManager.registerFlow(filmCardFlow);
flowManager.registerFlow(filmSearchFlow);
flowManager.registerFlow(bookCardFlow);
flowManager.registerFlow(bookSearchFlow);
flowManager.registerFlow(rotinaFlow);
flowManager.registerFlow(life360Flow);
flowManager.registerFlow(vinculo360Flow);
flowManager.registerFlow(ajudaFlow);

const logger = require("../../utils/logger");
const { jidFromContact } = require("../../utils/whatsapp/getUserData");

const bootLog = require("../../lib/bootLog");
bootLog.line("flows", {
  ok: true,
  extra: `n=${flowManager.flows.size}`,
});

module.exports = {
  name: "menu",
  aliases: ["m"],
  description: "Menu interativo de teste",

  async execute(context) {
    const { client, message } = context;
    const msg = message; // Compatibilidade
    const chatId = msg.from;

    // Usar getContact() para obter o número real (@c.us)
    let userId = msg.author || msg.from;
    try {
      const contact = await msg.getContact();
      const j = jidFromContact(contact);
      if (j) userId = j;
    } catch (err) {
      logger.debug("[Command:menu] Error getting contact:", err.message);
    }

    logger.debug("[Command:menu] Starting flow for", { userId, chatId });
    logger.debug("[Command:menu] FlowManager available?", !!flowManager);
    logger.debug("[Command:menu] Client available?", !!client);

    try {
      await flowManager.startFlow(client, chatId, userId, "test");
      logger.debug("[Command:menu] Flow started successfully");
    } catch (err) {
      logger.error("[Command:menu] Error starting flow:", err);
      logger.debug("[Command:menu] Error stack:", err.stack);
      await client.sendMessage(
        chatId,
        "❌ Erro ao iniciar menu: " + err.message,
      );
    }
  },
};
