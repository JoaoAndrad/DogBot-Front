const flowManager = require("../../components/menu/flowManager");
const logger = require("../../utils/logger");

module.exports = {
  name: "stats",
  aliases: ["estatisticas", "resumo"],
  description: "Envia card com estatísticas musicais do Spotify",

  async execute(ctx) {
    const { message, client, reply } = ctx;
    const chatId = message.from;
    const userId = message.author || message.from;

    try {
      // Abrir o menu de estatísticas do Spotify Flow
      const spotifyFlow = flowManager.getFlow("spotify");
      
      if (!spotifyFlow) {
        return reply("❌ Flow do Spotify não encontrado.");
      }
      
      // Criar contexto para o flow
      const flowCtx = {
        userId,
        chatId,
        client,
        reply: (text) => client.sendMessage(chatId, text),
      };
      
      // Navegar diretamente para o menu de estatísticas
      await flowManager.openFlow("spotify", flowCtx, "/stats");
      
    } catch (err) {
      logger.error("[stats] erro:", err);
      return reply("❌ Erro ao abrir menu de estatísticas.");
    }
  },
};
