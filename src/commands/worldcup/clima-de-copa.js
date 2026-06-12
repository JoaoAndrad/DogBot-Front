"use strict";

const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "clima-de-copa",
  aliases: [],
  description: "Ativa ou gerencia o sistema Copa do Mundo no grupo",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    if (!isGroup) {
      await client.sendMessage(chatId, "⚽ Este comando só funciona em grupos. Adicione o bot a um grupo e tente novamente.");
      return;
    }

    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[clima-de-copa] getContact error:", e.message);
    }

    if (!context.lookupResult || context.lookupResult.confessions_vip !== true) {
      await client.sendMessage(chatId, "🚫 O comando */clima-de-copa* é exclusivo para membros VIP do DogBot.");
      return;
    }

    const body = (message.body || "").trim().toLowerCase();
    const isOff = body.endsWith("off");

    try {
      if (isOff) {
        await worldcupClient.deactivateGroup(chatId);
        await client.sendMessage(chatId, "⚽ Sistema Copa do Mundo *desativado* neste grupo.\nUse */clima-de-copa* para reativar quando quiser.");
        return;
      }

      const result = await worldcupClient.activateGroup(chatId, userId);

      if (result.alreadyActive) {
        const s = result.settings;
        const lines = [
          "⚽ *Copa do Mundo já está ativa neste grupo!*",
          "",
          `🔔 Notificações de gol: ${s.goal_notifications ? "✅" : "❌"}`,
          `⏰ Lembretes de jogo: ${s.match_reminders ? "✅" : "❌"}`,
          `📊 Resumo semanal: ${s.weekly_summary ? "✅" : "❌"}`,
          `🎯 Bolão: ${s.prediction_enabled ? "✅" : "❌"}`,
          "",
          "Use */copa* para abrir o menu ou */clima-de-copa off* para desativar.",
        ];
        await client.sendMessage(chatId, lines.join("\n"));
        return;
      }

      const lines = [
        "⚽ *Clima Copa do Mundo ativado!* 🎉",
        "",
        "A partir de agora este grupo recebe:",
        "🔔 Notificações de gol em tempo real",
        "⏰ Lembretes antes dos jogos",
        "📊 Resumo semanal das partidas",
        "🎯 Bolão de palpites",
        "",
        "*Comandos disponíveis:*",
        "*/copa* — menu interativo",
        "*/proxjogo* — próximo jogo",
        "*/jogoshoje* — jogos de hoje",
        "*/tabela* — classificação",
        "*/palpite* — fazer ou visualizar palpites (no privado)",
        "*/placar* — ranking do grupo",
      ];
      await client.sendMessage(chatId, lines.join("\n"));
    } catch (e) {
      logger.error("[clima-de-copa]", e.message);
      await client.sendMessage(chatId, "❌ Erro ao ativar o sistema Copa: " + e.message);
    }
  },
};
