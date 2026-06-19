"use strict";

const worldcupClient = require("../../services/worldcupClient");
const logger = require("../../utils/logger");

module.exports = {
  name: "bolao",
  aliases: [],
  description: "Cria um bolão Copa para o grupo (apenas admin do grupo)",

  async execute(context) {
    const { client, message } = context;
    const chatId = message.from;
    const isGroup = String(chatId).endsWith("@g.us");

    if (!isGroup) {
      await client.sendMessage(chatId, "⚽ Use */bolao* em um grupo com o clima de copa ativado.");
      return;
    }

    // Verifica se o sistema copa está ativo neste grupo
    try {
      const settings = await worldcupClient.getGroupSettings(chatId);
      if (!settings || !settings.active) {
        await client.sendMessage(chatId, "⚽ O sistema Copa não está ativo neste grupo. Use */clima-de-copa* para ativar.");
        return;
      }
    } catch (e) {
      logger.error("[bolao] settings error:", e.message);
      await client.sendMessage(chatId, "❌ Erro ao verificar configurações do grupo.");
      return;
    }

    // Verifica se o remetente é admin do grupo
    let senderJid = message.author || message.from;
    try {
      const contact = await message.getContact();
      if (contact && contact.id && contact.id._serialized) senderJid = contact.id._serialized;
    } catch (_) {}

    let chat;
    try {
      chat = client.getChatById ? await client.getChatById(chatId) : await message.getChat();
    } catch (e) {
      logger.error("[bolao] getChatById error:", e.message);
      await client.sendMessage(chatId, "❌ Erro ao acessar informações do grupo.");
      return;
    }

    const participants = chat.participants || [];
    const senderParticipant = participants.find(
      (p) => (p.id._serialized || `${p.id.user}@c.us`) === senderJid,
    );

    if (!senderParticipant || (!senderParticipant.isAdmin && !senderParticipant.isSuperAdmin)) {
      await client.sendMessage(chatId, "🚫 Apenas *administradores do grupo* podem criar um bolão.");
      return;
    }

    // Verifica se já existe bolão ativo
    try {
      const existing = await worldcupClient.getBolao(chatId);
      if (existing && existing.bolao) {
        await client.sendMessage(
          chatId,
          "🎲 Este grupo já tem um bolão ativo.\n\nPara substituí-lo, desative o atual pelo painel de administração e depois use */bolao* novamente.",
        );
        return;
      }
    } catch (_) {}

    // Coleta JIDs de todos os participantes, excluindo o próprio bot
    const botJid =
      (client.info && client.info.wid && client.info.wid._serialized) ||
      (client.info && client.info.me && client.info.me._serialized);
    const senderNumbers = participants
      .map((p) => p.id._serialized || `${p.id.user}@c.us`)
      .filter((jid) => !botJid || jid !== botJid);

    try {
      const { bolao } = await worldcupClient.createBolao(chatId, senderNumbers, {
        createdBy: senderJid,
      });

      const lines = [
        "🎲 *Bolão da Copa criado!*",
        "",
        `Todos os ${senderNumbers.length} participantes do grupo foram adicionados.`,
        "A pontuação do bolão parte do zero, apenas pontos conquistados *a partir de agora* contam.",
        "",
        "Use */placar* para ver o ranking do bolão.",
      ];
      await client.sendMessage(chatId, lines.join("\n"));
      logger.info(`[bolao] criado ${bolao.id} no grupo ${chatId} por ${senderJid}`);
    } catch (e) {
      logger.error("[bolao]", e.message);
      await client.sendMessage(chatId, "❌ Não foi possível criar o bolão: " + e.message);
    }
  },
};
