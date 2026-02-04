const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "limparaleatorio",
  aliases: ["resetaleatorio", "limparrec"],
  description:
    "Limpa o histórico de recomendações do /aleatorio para permitir músicas repetidas",
  adminOnly: false, // Can be changed to true if you want only admins to use this

  async execute(ctx) {
    const { message, reply } = ctx;
    const msg = message;
    const chatId = msg.from;

    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));
    if (!isGroup) {
      return reply("⚠️ Este comando só funciona em grupos.");
    }

    try {
      await reply("⏳ Limpando histórico de recomendações...");

      const result = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}/playlist/blacklist`,
        null,
        "DELETE",
      );

      if (!result || !result.success) {
        return reply(
          `❌ Erro ao limpar histórico: ${result?.error || "Erro desconhecido"}`,
        );
      }

      const count = result.count || 0;
      await reply(
        `✅ Histórico de recomendações limpo!\n\n` +
          `${count} música(s) removida(s) do histórico.\n` +
          `Agora o /aleatorio poderá recomendar estas músicas novamente.`,
      );
    } catch (err) {
      logger.error("[limparaleatorio] erro:", err && err.message);
      return reply(
        "❌ Ocorreu um erro ao limpar o histórico. Tente novamente mais tarde.",
      );
    }
  },
};
