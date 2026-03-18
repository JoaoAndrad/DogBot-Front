/**
 * commands/misc/adicionarfilme.js — Command to add a film to a list
 * Usage: /adicionarfilme Nome do Filme
 */

const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");

module.exports = {
  name: "adicionarfilme",
  aliases: ["adicionar-filme", "addfilm", "add-film"],
  description: "➕ Adicionar um filme a uma lista",

  async execute(context) {
    const { client, message, reply, lookupResult } = context;
    const msg = message;
    let userId = lookupResult?.userId || msg.author || msg.from;
    if (!lookupResult?.userId) {
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          userId = contact.id._serialized;
        }
      } catch (err) {
        logger.debug("[adicionarfilme] Error getting contact:", err.message);
      }
    }

    const body = msg.body || "";
    const filmName = body.replace(/^\/adicionar-?filme\s*/i, "").trim();

    if (!filmName) {
      return reply(
        "❌ Use: /adicionarfilme Nome do Filme\n\n" +
          "Exemplo: /adicionarfilme Inception",
      );
    }

    // Start interactive flow with poll-based list selection
    try {
      logger.info(`[adicionarfilme] Starting add-film flow for: "${filmName}"`);

      await flowManager.startFlow(client, msg.from, userId, "add-film", {
        initialContext: { filmName },
      });
    } catch (err) {
      logger.error("[adicionarfilme] Error starting flow:", err.message);
      return reply(`❌ Erro ao iniciar processo: ${err.message}`);
    }
  },
};
