const backendClient = require("../../services/backendClient");
const { renderCard } = require("../../services/statsCardService");
const logger = require("../../utils/logger");

module.exports = {
  name: "stats",
  aliases: ["estatisticas", "resumo"],
  description: "Envia card com estatísticas musicais do grupo",

  async execute(ctx) {
    const { message, client, reply } = ctx;
    const chatId = message.from;

    try {
      // Fetch aggregated stats from backend for this group
      let data = null;
      try {
        data = await backendClient.sendToBackend(
          `/api/groups/${encodeURIComponent(chatId)}/stats`,
          null,
          "GET"
        );
      } catch (err) {
        logger.warn(
          "[stats] Falha ao obter stats do backend:",
          err && err.message
        );
      }

      if (!data) {
        return reply("❌ Não foi possível obter estatísticas do backend.");
      }

      // Map backend shapes to the template expected by the stats card
      let templateData = null;
      if (data.stats) {
        templateData = data.stats;
      } else if (data.summary || data.activity) {
        const json = data;
        const sum = json.summary || {};

        function fmtDuration(ms) {
          const totalMin = Math.floor(ms / 60000);
          const hours = Math.floor(totalMin / 60);
          const mins = totalMin % 60;
          return `${hours}h ${mins}min`;
        }

        const maxCount = Math.max(
          ...(json.activity || []).map((d) => d.count),
          1
        );
        const bars = (json.activity || []).map((d) => {
          const percent = Math.round(((d.count || 0) / maxCount) * 100);
          return {
            label: d.day || d.label || "",
            height: d.count || 0,
            percent,
          };
        });

        const top3 = (json.topArtists || [])
          .slice(0, 3)
          .map((a) => ({ name: a.name, plays: a.count || 0 }));
        const repeat = (json.repeats || []).slice(0, 3).map((r) => ({
          song: (r.track && r.track.name) || r.id || "Desconhecida",
          artist:
            r.track && Array.isArray(r.track.artists)
              ? r.track.artists.join(", ")
              : (r.track && r.track.artists) || "",
        }));
        const segments = {
          morning: json.timeOfDay?.morning || 0,
          afternoon: json.timeOfDay?.afternoon || 0,
          night: json.timeOfDay?.evening || 0,
          dawn: json.timeOfDay?.night || 0,
        };

        const discoveries = (json.discoveries || []).slice(0, 3).map((d) => ({
          title: (d.track && d.track.name) || d.name || "Desconhecida",
          artist:
            d.track && Array.isArray(d.track.artists)
              ? d.track.artists.join(", ")
              : (d.track && d.track.artists) || "",
        }));

        const lastTracks = (json.last3 || []).slice(0, 3).map((r) => ({
          title: r.track?.name || r.name || "",
          artist: Array.isArray(r.track?.artists)
            ? r.track.artists.join(", ")
            : r.track?.artists || "",
        }));

        templateData = {
          period: json.period || "Este mês",
          total: sum.totalPlays || 0,
          unique: sum.uniqueTracks || 0,
          time: fmtDuration(sum.totalMs || sum.totalListenMs || 0),
          bars,
          top3,
          repeat,
          segments,
          discoveries,
          lastTracks,
        };
      } else {
        return reply(
          "❌ Sem dados de estatísticas disponíveis para este grupo."
        );
      }

      const img = await renderCard(templateData, {
        width: 800,
        height: 1200,
        outputWidth: 400,
      });
      const { MessageMedia } = require("whatsapp-web.js");
      const media = new MessageMedia("image/png", img.toString("base64"));
      await client.sendMessage(chatId, media, { caption: "Suas estatísticas" });
    } catch (err) {
      logger.error("[stats] erro:", err);
      return reply("❌ Erro ao gerar o card de estatísticas.");
    }
  },
};
