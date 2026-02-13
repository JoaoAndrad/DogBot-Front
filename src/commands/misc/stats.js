const backendClient = require("../../services/backendClient");
const { renderCard } = require("../../services/statsCardService");
const logger = require("../../utils/logger");
const polls = require("../../components/poll");
const fetch = require("node-fetch");
const path = require("path");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

async function resolveUserUuid(externalId) {
  if (!externalId) return null;
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      externalId
    );
  if (isUUID) return externalId;

  try {
    const url = `${BACKEND_URL}/api/users/by-identifier/${encodeURIComponent(
      externalId
    )}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.user && json.user.id ? json.user.id : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  name: "stats",
  aliases: ["estatisticas", "resumo"],
  description: "Envia card com estatísticas musicais do Spotify",

  async execute(ctx) {
    const { message, client, reply } = ctx;
    const chatId = message.from;
    const userId = message.author || message.from;

    try {
      // Criar enquete para escolher o período
      const periodOptions = [
        "Esse mês",
        "Últimos 7 dias",
        "Últimos 30 dias",
        "Últimos 90 dias",
        "Geral"
      ];

      const pollResult = await polls.createPoll(
        client,
        chatId,
        "📊 Escolha o período das estatísticas:",
        periodOptions
      );
      
      if (!pollResult || !pollResult.msgId) {
        return reply("❌ Erro ao criar enquete de estatísticas.");
      }
      
      const { msgId } = pollResult;
      
      // Usar evento global para detectar voto
      const voteListener = async (payload) => {
        // Verificar se é voto nesta enquete específica
        if (payload.messageId !== msgId) return;
        
        // Apenas o usuário que solicitou pode votar
        if (payload.voter !== userId) return;
        
        const selectedIndex = (payload.selectedIndexes || [])[0];
        if (selectedIndex == null) return;
        
        const selected = periodOptions[selectedIndex];
        
        // Remover listener após processar o voto
        polls.off("vote", voteListener);
        
        // Mapear seleção para parâmetros
        let period = null;
        let days = 7;
        let displayLabel = selected;
        
        if (selected === "Esse mês") {
          period = "month";
          const now = new Date();
          displayLabel = now.toLocaleString('pt-BR', { month: 'long' });
        } else if (selected === "Últimos 7 dias") {
          days = 7;
        } else if (selected === "Últimos 30 dias") {
          days = 30;
        } else if (selected === "Últimos 90 dias") {
          days = 90;
        } else if (selected === "Geral") {
          days = 0;
          displayLabel = "Geral";
        }
        
        // Buscar estatísticas
        const resolved = await resolveUserUuid(userId);
        const userParam = resolved || userId;
        const isGroup = !!(chatId && String(chatId).endsWith("@g.us"));
        
        let url = `${BACKEND_URL}/api/spotify/stats?userId=${encodeURIComponent(userParam)}`;
        
        if (period === "month") {
          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          url += `&from=${encodeURIComponent(monthStart.toISOString())}`;
          url += `&to=${encodeURIComponent(new Date().toISOString())}`;
        } else {
          if (days && Number(days) > 0) url += `&days=${Number(days)}`;
        }
        
        if (isGroup) url += `&scope=group`;
        if (displayLabel) url += `&period=${encodeURIComponent(displayLabel)}`;
        
        const res = await fetch(url, { method: "GET" });
        const json = await res.json();
        
        if (!json) {
          await client.sendMessage(chatId, "❌ Erro ao obter estatísticas.");
          return;
        }
        
        // Gerar card
        function fmtDuration(ms) {
          const totalMin = Math.floor(ms / 60000);
          return totalMin;
        }
        
        const sum = json.summary || {};
        const logoPath = path.join(__dirname, "..", "..", "..", "templates", "logo.png");
        
        const templateData = {
          period: displayLabel,
          total: sum.totalPlays || 0,
          unique: sum.uniqueTracks || 0,
          time: fmtDuration(sum.totalListenMs || 0),
          albumImages: json.topAlbumImages || [],
          logoPath: logoPath,
          top5Artists: (json.topArtists || [])
            .slice(0, 5)
            .map((a) => ({ name: a.name, plays: a.count || 0 })),
          top5Songs: (json.repeats || []).slice(0, 5).map((r) => ({
            song: (r.track && r.track.name) || r.id || "Desconhecida",
            artist:
              r.track && Array.isArray(r.track.artists)
                ? r.track.artists.join(", ")
                : (r.track && r.track.artists) || "",
            plays: r.count || r.plays || r.playCount || 0,
          })),
        };
        
        try {
          const img = await renderCard(templateData, {
            width: 706,
            height: 100,
            outputWidth: 706,
          });
          const { MessageMedia } = require("whatsapp-web.js");
          const media = new MessageMedia("image/png", img.toString("base64"));
          await client.sendMessage(chatId, media, { caption: "" });
        } catch (e) {
          logger.error("[stats] erro ao renderizar card:", e);
          await client.sendMessage(chatId, "❌ Erro ao gerar o card de estatísticas.");
        }
      };
      
      // Registrar listener para votos
      polls.on("vote", voteListener);
      
      // Remover listener após 5 minutos para evitar vazamento de memória
      setTimeout(() => {
        polls.off("vote", voteListener);
      }, 5 * 60 * 1000);
      
    } catch (err) {
      logger.error("[stats] erro:", err);
      return reply("❌ Erro ao criar enquete de estatísticas.");
    }
  },
};
