"use strict";

const { MessageMedia } = require("whatsapp-web.js");
const worldcupClient = require("../../services/worldcupClient");
const { renderStandingsCard } = require("../../services/worldcupCardService");
const logger = require("../../utils/logger");

function parseGroupArg(body) {
  const m = body.match(/(?:tabela\s+)?grupo\s+([a-lA-L])/i) || body.match(/\bgrupo\s+([a-lA-L])\b/i);
  if (m) return m[1].toUpperCase();
  const m2 = body.match(/\b([a-lA-L])\b/i);
  if (m2) return m2[1].toUpperCase();
  return null;
}

module.exports = {
  name: "tabela",
  aliases: ["grupo"],
  description: "Exibe a tabela da Copa do Mundo como imagem. Ex: /tabela grupo a",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const body = (message.body || "").trim().toLowerCase();
    const groupLetter = parseGroupArg(body);

    try {
      const { groups } = await worldcupClient.getStandingsGrouped(groupLetter || null);

      if (!groups || !groups.length) {
        await client.sendMessage(chatId, "⚽ Nenhuma classificação disponível ainda.\nUse */tabela grupo A* (substitua A pela letra do grupo).");
        return;
      }

      const buffer = await renderStandingsCard(groups);
      const media = new MessageMedia("image/png", buffer.toString("base64"), "tabela.png");
      await client.sendMessage(chatId, media, { caption: "" });
    } catch (e) {
      logger.error("[tabela]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível gerar a tabela.");
    }
  },
};
