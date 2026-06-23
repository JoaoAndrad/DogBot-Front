"use strict";

const flowManager = require("../../components/menu/flowManager");
const { renderStandingsCard } = require("../../services/worldcupCardService");
const { sendBufferAsSticker } = require("../../utils/media/stickerHelper");
const worldcupClient = require("../../services/worldcupClient");
const { searchTeams, localize } = require("../../utils/teamLocale");
const logger = require("../../utils/logger");

function parseGroupLetter(body) {
  // "/tabela grupo a", "/tabela a", "/grupo a"
  const m = body.match(/\bgrupo\s+([a-lA-L])\b/i);
  if (m) return m[1].toUpperCase();
  const m2 = body.match(/\b([a-lA-L])\b/i);
  if (m2) return m2[1].toUpperCase();
  return null;
}

function extractQuery(body) {
  // Remove o comando (/tabela, /grupo) e retorna o resto
  return body.replace(/^\/(tabela|grupo)\s*/i, "").trim();
}

async function findGroupByTeamName(query) {
  const results = searchTeams(query, 1);
  if (!results.length) return null;
  const ptName = results[0].pt;

  const { standings } = await worldcupClient.getStandings();
  if (!standings || !standings.length) return null;

  const entry = standings.find((s) => localize(s.team_name).pt === ptName);
  if (!entry || !entry.group_name) return null;

  // "Group K" → "K"
  const letter = entry.group_name.replace(/^group\s+/i, "").trim();
  return letter.length === 1 ? letter.toUpperCase() : null;
}

module.exports = {
  name: "tabela",
  aliases: ["grupo"],
  description: "Tabela da Copa. /tabela → enquete | /tabela J → grupo | /tabela portugal → por seleção",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const body = (message.body || "").trim();
    const query = extractQuery(body);

    let userId = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) userId = contact.id._serialized;
    } catch (e) {
      logger.debug("[tabela] getContact:", e.message);
    }

    // Letra de grupo direto: /tabela J
    let groupLetter = parseGroupLetter(query);

    // Nome de seleção: /tabela portugal
    if (!groupLetter && query.length >= 3) {
      try {
        groupLetter = await findGroupByTeamName(query);
        if (!groupLetter) {
          await client.sendMessage(chatId, `⚽ Seleção não encontrada: *${query}*`);
          return;
        }
      } catch (e) {
        logger.error("[tabela] findGroup:", e.message);
        await client.sendMessage(chatId, "❌ Erro ao buscar grupo.");
        return;
      }
    }

    // Com grupo → envia figurinha diretamente
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

    // Sem argumento → abre enquete de seleção via flow
    try {
      await flowManager.startFlow(client, chatId, userId, "copa", { initialPath: "/tabela" });
    } catch (e) {
      logger.error("[tabela] flow:", e.message);
      await client.sendMessage(chatId, "❌ Erro ao abrir tabela: " + e.message);
    }
  },
};
