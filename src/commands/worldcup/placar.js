"use strict";

const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "placar",
  aliases: [],
  description: "Ranking de palpites do grupo na Copa do Mundo",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    if (!isGroup) {
      await client.sendMessage(chatId, "⚽ Use */placar* em um grupo para ver o ranking daquele grupo.");
      return;
    }

    try {
      const settings = await worldcupClient.getGroupSettings(chatId);
      if (!settings || !settings.active) {
        await client.sendMessage(chatId, "⚽ O sistema Copa não está ativo neste grupo. Use */clima-de-copa* para ativar.");
        return;
      }
    } catch (e) {
      logger.error("[placar] settings error:", e.message);
    }

    try {
      const chat = client.getChatById
        ? await client.getChatById(chatId)
        : await message.getChat();
      const participants = chat.participants || [];
      const userIds = participants.map((p) => p.id._serialized || p.id.user + "@c.us");

      // Verifica se há bolão ativo — se sim, usa pontuação do bolão
      let bolaoData = null;
      try {
        bolaoData = await worldcupClient.getBolao(chatId);
      } catch (_) {}

      const hasBolao = bolaoData && bolaoData.bolao && bolaoData.leaderboard && bolaoData.leaderboard.length > 0;

      if (hasBolao) {
        const { leaderboard } = bolaoData;
        const lines = ["🎲 *Bolão da Copa — Ranking*", ""];
        const medals = ["🥇", "🥈", "🥉"];

        for (let i = 0; i < leaderboard.length; i++) {
          const entry = leaderboard[i];
          const medal = medals[i] || `${i + 1}.`;
          const name = entry.pushName || entry.displayName || (entry.senderNumber ? entry.senderNumber.split("@")[0] : "?");
          const pts = entry.bolaoPoints === 1 ? "pt" : "pts";
          lines.push(`${medal} ${name} — *${entry.bolaoPoints} ${pts}*`);
        }

        lines.push("", "_Pontuação contada a partir da criação do bolão_");

        // Ranking geral do grupo (pontuação total, todos os participantes)
        try {
          const { leaderboard: general } = await worldcupClient.getLeaderboard(chatId, userIds);
          if (general && general.length) {
            lines.push("", "──────────────────", "🏆 *Ranking Geral do Grupo*", "");
            for (let i = 0; i < general.length; i++) {
              const entry = general[i];
              const medal = medals[i] || `${i + 1}.`;
              const name = entry.pushName || entry.displayName || (entry.senderNumber ? entry.senderNumber.split("@")[0] : "?");
              const pts = entry.totalPoints === 1 ? "pt" : "pts";
              lines.push(`${medal} ${name} — *${entry.totalPoints} ${pts}*`);
            }
          }
        } catch (_) {}

        await client.sendMessage(chatId, lines.join("\n"));
        return;
      }

      // Ranking geral
      const { leaderboard } = await worldcupClient.getLeaderboard(chatId, userIds);

      if (!leaderboard || !leaderboard.length) {
        await client.sendMessage(chatId, "⚽ Nenhum palpite pontuado ainda. Use */palpite* (no privado) para participar!");
        return;
      }

      const lines = ["🏆 *Ranking de Palpites — Copa do Mundo*", ""];
      const medals = ["🥇", "🥈", "🥉"];

      for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const medal = medals[i] || `${i + 1}.`;
        const name =
          entry.pushName ||
          entry.displayName ||
          (entry.senderNumber ? entry.senderNumber.split("@")[0] : "?");
        const pts = entry.totalPoints === 1 ? "pt" : "pts";
        const palpites = entry._count && entry._count.points === 1 ? "palpite" : "palpites";
        const count = entry._count ? entry._count.points : 0;
        lines.push(`${medal} ${name} — *${entry.totalPoints} ${pts}* (${count} ${palpites})`);
      }

      await client.sendMessage(chatId, lines.join("\n"));
    } catch (e) {
      logger.error("[placar]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar o ranking.");
    }
  },
};
