const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");

module.exports = {
  name: "stats",
  aliases: ["estatisticas", "resumo"],
  description: "Envia card com estatísticas musicais do Spotify",

  async execute(ctx) {
    const { message, client, reply } = ctx;
    const chatId = message.from;
    
    // Usar getContact() para obter o número real (@c.us) ao invés de @lid
    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) {
        userId = contact.id._serialized;
      }
    } catch (err) {
      logger.error("[stats] Error getting contact:", err.message);
    }

    try {
      // Abrir o Spotify Flow diretamente no menu de estatísticas
      // Primeiro, vamos salvar o estado inicial apontando para /stats
      const storage = require("../../components/menu/storage");
      
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos
      await storage.saveState(userId, "spotify", {
        path: "/stats",
        history: ["/"],
        context: {},
        expiresAt: expiresAt.toISOString(),
      });
      
      // Renderizar o nó /stats diretamente
      await flowManager._renderNode(client, chatId, userId, "spotify", "/stats");
      
    } catch (err) {
      logger.error("[stats] erro:", err);
      return reply("❌ Erro ao abrir menu de estatísticas.");
    }
  },
};
