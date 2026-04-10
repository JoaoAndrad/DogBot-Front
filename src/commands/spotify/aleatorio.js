const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");

/** `true` = comando desativado (voltar a `false` para reativar). */
const ALEATORIO_DESATIVADO = true;

module.exports = {
  name: "aleatorio",
  description: "Toca faixas aleatórias únicas baseadas na playlist do grupo",

  async execute(ctx) {
    if (ALEATORIO_DESATIVADO) {
      const { reply } = ctx;
      return reply(
        "⏸️ O comando /aleatorio está temporariamente desativado.",
      );
    }

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

      // Get user WhatsApp identifier
      let whatsappId = null;
      try {
        const contact = await msg.getContact();
        whatsappId = contact.id._serialized || msg.author || msg.from;
      } catch (e) {
        whatsappId = msg.author || msg.from;
      }

      // Lookup user UUID
      const userLookup = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(whatsappId)}`,
        null,
        "GET",
      );

      if (!userLookup || !userLookup.found || !userLookup.userId) {
        return reply(
          "⚠️ Você precisa estar cadastrado. Use /cadastro para se registrar.",
        );
      }

      if (!userLookup.hasSpotify) {
        return reply(
          "⚠️ Você precisa conectar sua conta do Spotify. Use /conectar para vincular.",
        );
      }

      // Ask backend to perform shuffle
      await reply(
        "⏳ Verificando a playlist do grupo e preparando músicas recomendadas...",
      );

      const shuffleRes = await backendClient.sendToBackend(
        `/api/groups/${encodeURIComponent(chatId)}/playlist/shuffle`,
        {
          playNow: true,
          limit: 6,
          replaceQueue: true,
          userId: userLookup.userId, // Pass user ID to create playlist in their account
        },
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
