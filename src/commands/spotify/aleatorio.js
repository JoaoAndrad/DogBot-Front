const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "aleatorio",
  description: "Toca faixas aleatórias únicas baseadas na playlist do grupo",

  async execute(ctx) {
    const { message, reply } = ctx;
    const msg = message;
    const chatId = msg.from;

    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));
    if (!isGroup) {
      return reply("⚠️ Este comando só funciona em grupos.");
    }

    // Check if group has playlist
    try {
      const groupRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}`,
        null,
        "GET",
      );
      const group = groupRes?.group;
      if (!group || !group.playlistId) {
        return reply(
          "⚠️ Este grupo não tem playlist configurada. Use /playlist set <id> para vincular.",
        );
      }

      // Ask backend to perform shuffle
      await reply(
        "⏳ Verificando a playlist do grupo e preparando músicas recomendadas...",
      );

      const shuffleRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}/playlist/shuffle`,
        { playNow: true, limit: 6, replaceQueue: true },
        "POST",
      );

      if (!shuffleRes) return reply("❌ Falha ao comunicar com o servidor.");
      if (shuffleRes.error) return reply(`❌ Erro: ${shuffleRes.error}`);

      // Provide a brief summary to group
      const out = "✅ Fila de indicações criada! Verifique seu Spotify";
      await reply(out);
    } catch (err) {
      logger.error("[aleatorio] erro:", err && err.message);
      return reply(
        "❌ Ocorreu um erro ao executar /aleatorio. Tente novamente mais tarde.",
      );
    }
  },
};
