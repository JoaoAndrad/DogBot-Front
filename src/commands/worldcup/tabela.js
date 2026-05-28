"use strict";

const flowManager = require("../../components/menu/flowManager");
const { renderStandingsCard } = require("../../services/worldcupCardService");
const { sendBufferAsSticker } = require("../../utils/media/stickerHelper");
const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

function parseGroupArg(body) {
  // "/tabela grupo a", "/grupo b", "/tabela b"
  const m = body.match(/(?:tabela\s+)?grupo\s+([a-lA-L])/i) || body.match(/\bgrupo\s+([a-lA-L])\b/i);
  if (m) return m[1].toUpperCase();
  // letra solta no final: "/tabela a"
  const m2 = body.match(/\b([a-lA-L])\b/i);
  if (m2) return m2[1].toUpperCase();
  return null;
}

module.exports = {
  name: "tabela",
  aliases: ["grupo"],
  description: "Tabela da Copa. /tabela → enquete de grupo | /tabela grupo a → direto",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const body = (message.body || "").trim().toLowerCase();
    const groupLetter = parseGroupArg(body);

    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[tabela] getContact:", e.message);
    }

    // Com grupo especificado → envia figurinha diretamente
    if (groupLetter) {
      try {
        const { groups } = await worldcupClient.getStandingsGrouped(groupLetter);
        if (!groups || !groups.length) {
          await client.sendMessage(chatId, `⚽ Dados do Grupo ${groupLetter} ainda não disponíveis.`);
          return;
        }
        const buffer = await renderStandingsCard(groups);
        await sendBufferAsSticker(client, chatId, buffer, { fullOnly: true });
      } catch (e) {
        logger.error("[tabela] render:", e.message);
        await client.sendMessage(chatId, "❌ Erro ao gerar tabela.");
      }
      return;
    }

    // Sem grupo → abre enquete de seleção via flow
    try {
      await flowManager.startFlow(client, chatId, userId, "copa", { initialPath: "/tabela" });
    } catch (e) {
      logger.error("[tabela] flow:", e.message);
      await client.sendMessage(chatId, "❌ Erro ao abrir tabela: " + e.message);
    }
  },
};
