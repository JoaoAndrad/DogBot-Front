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
        const jid = entry.senderNumber
          ? (String(entry.senderNumber).includes("@") ? entry.senderNumber : `${entry.senderNumber}@c.us`)
          : null;
        const participant = jid
          ? participants.find((p) => (p.id._serialized || p.id.user + "@c.us") === jid)
          : null;
        const name =
          (participant && (participant.pushname || participant.name)) ||
          entry.pushName ||
          entry.displayName ||
          (jid ? jid.split("@")[0] : "?");
        lines.push(`${medal} ${name} — *${entry.totalPoints} pts* (${entry.predictionsScored} palpite(s))`);
      }

      await client.sendMessage(chatId, lines.join("\n"));
    } catch (e) {
      logger.error("[placar]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível buscar o ranking.");
    }
  },
};
