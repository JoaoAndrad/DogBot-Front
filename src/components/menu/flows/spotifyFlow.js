const { createFlow } = require("../flowBuilder");
const fetch = require("node-fetch");
const spotifyClient = require("../../../services/spotifyClient");
const polls = require("../../poll");
const backendClient = require("../../../services/backendClient");
const { renderCard } = require("../../../services/statsCardService");
const {
  sendTrackSticker,
  sendCompositeSticker,
} = require("../../../utils/stickerHelper");

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

function formatTrack(t) {
  if (!t) return "(nenhuma faixa)";
  const artists = Array.isArray(t.artists) ? t.artists.join(", ") : t.artists;
  return `${t.name} — ${artists}${t.album ? ` \nÁlbum: ${t.album}` : ""}`;
}

function msToTime(ms) {
  if (!ms && ms !== 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function renderProgressBar(percent, width = 16) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;
  return "[" + "█".repeat(filled) + "-".repeat(empty) + "]";
}

const spotifyFlow = createFlow("spotify", {
  root: {
    title: "🎵 Spotify",
    dynamic: true,
    handler: async (ctx) => {
      // Build options; include 'Todos' when opened in a group chat
      const isGroup = !!(
        ctx &&
        ctx.chatId &&
        String(ctx.chatId).endsWith("@g.us")
      );
      const opts = [];

      // Só mostrar opção Conectar no privado
      if (!isGroup) {
        opts.push({
          label: "🔗 Conectar / Reconectar",
          action: "exec",
          handler: "connect",
        });
      }

      opts.push(
        {
          label: "🎧 Tocando agora",
          action: "exec",
          handler: "currentlyPlaying",
        },
        {
          label: "📊 Estatísticas",
          action: "goto",
          target: "/stats",
        }
      );

      if (isGroup) {
        opts.push({
          label: "👥 Todos (grupo)",
          action: "exec",
          handler: "todosMenu",
        });
      }

      opts.push({ label: "📜 Histórico", action: "goto", target: "/history" });
      opts.push({ label: "❌ Sair", action: "exec", handler: "exit" });

      return { options: opts };
    },
  },

  "/stats": {
    title: "📊 Estatísticas — escolha",
    options: [
      {
        label: "Esse mês",
        action: "exec",
        handler: "stats",
        data: { period: "month" },
      },
      {
        label: "Últimos 7 dias",
        action: "exec",
        handler: "stats",
        data: { days: 7 },
      },
      {
        label: "Últimos 30 dias",
        action: "exec",
        handler: "stats",
        data: { days: 30 },
      },
      {
        label: "Últimos 90 dias",
        action: "exec",
        handler: "stats",
        data: { days: 90 },
      },
      {
        label: "Geral",
        action: "exec",
        handler: "stats",
        data: { days: 0 },
      },
      { label: "⬅️ Voltar", action: "back" },
    ],
  },

  "/history": {
    title: "📜 Histórico — escolha",
    options: [
      {
        label: "Últimos 7 dias",
        action: "exec",
        handler: "historyRelative",
        data: { days: 7 },
      },
      {
        label: "Últimos 30 dias",
        action: "exec",
        handler: "historyRelative",
        data: { days: 30 },
      },
      { label: "Escolher mês", action: "goto", target: "/history/months" },
      { label: "⬅️ Voltar", action: "back" },
    ],
  },

  "/history/months": {
    title: "📅 Escolha um mês",
    dynamic: true,
    handler: async (ctx) => {
      // Present last 12 months as choices
      const opts = [];
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString("pt-BR", {
          month: "long",
          year: "numeric",
        });
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
          2,
          "0"
        )}`;
        opts.push({
          label: label,
          action: "exec",
          handler: "showMonth",
          data: { month: ym },
        });
      }
      opts.push({ label: "⬅️ Voltar", action: "back" });
      return { options: opts };
    },
  },

  handlers: {
    connect: async (ctx) => {
      try {
        const payload = { userId: ctx.userId };
        const res = await spotifyClient.startAuth(payload);
        if (res && res.auth_url) {
          await ctx.reply(
            `🔗 Abra o link para conectar o Spotify:\n${res.auth_url}`
          );
        } else {
          await ctx.reply(
            "❌ Não foi possível iniciar autenticação do Spotify."
          );
        }
      } catch (e) {
        await ctx.reply("❌ Erro ao iniciar autenticação: " + (e.message || e));
      }
      return { end: false };
    },

    currentlyPlaying: async (ctx) => {
      try {
        const resolved = await resolveUserUuid(ctx.userId);
        const userParam = resolved || ctx.userId;
        const url = `${BACKEND_URL}/api/spotify/current?userId=${encodeURIComponent(
          userParam
        )}`;
        const res = await fetch(url, { method: "GET" });
        const json = await res.json();
        if (json && json.notice) {
          await ctx.reply(json.notice);
        } else if (!json || !json.playing) {
          await ctx.reply("⏸️ Nenhuma faixa em reprodução no momento.");
        } else {
          const t = json.track || {};
          const durationMs = t.durationMs || 0;
          const positionMs =
            json.listenedMs ||
            Math.round(((json.percentPlayed || 0) / 100) * durationMs);
          const percent = Math.round(
            json.percentPlayed ||
              (durationMs ? (positionMs / durationMs) * 100 : 0)
          );
          const bar = renderProgressBar(percent, 18);

          let reply = `▶️ Tocando agora — ${t.name}\n`;
          reply += `${
            Array.isArray(t.artists) ? t.artists.join(", ") : t.artists || ""
          }\n`;
          if (t.album) reply += `Álbum: ${t.album}\n`;
          reply += `\n${bar} ${percent}%\n${msToTime(positionMs)} / ${msToTime(
            durationMs
          )}\n`;
          reply += `Iniciado: ${new Date(json.startedAt).toLocaleString()}`;

          await ctx.reply(reply);

          // Send track artwork as sticker
          const trackWithImage = {
            trackId: t.id,
            trackName: t.name,
            image: t.imageUrl,
          };
          await sendTrackSticker(ctx.client, ctx.chatId, trackWithImage);

          // Attempt to fetch and send preview audio via backend proxy
          try {
            const trackId = t.id;
            if (trackId) {
              const proxyUrl = `${BACKEND_URL}/api/spotify/preview?trackId=${encodeURIComponent(
                trackId
              )}`;
              console.log(
                `[spotifyFlow] fetching preview from proxy: ${proxyUrl}`
              );
              const ares = await fetch(proxyUrl, { method: "GET" });
              if (ares && ares.ok) {
                const contentType = ares.headers.get("content-type") || "";
                if (
                  contentType.includes("audio") ||
                  contentType.includes("mpeg") ||
                  contentType.includes("mp3")
                ) {
                  const buf = await ares.buffer();
                  const { MessageMedia } = require("whatsapp-web.js");
                  const media = new MessageMedia(
                    "audio/mpeg",
                    buf.toString("base64")
                  );
                  await ctx.client.sendMessage(ctx.chatId, media, {});
                  console.log("[spotifyFlow] preview audio sent");
                } else {
                  console.log(
                    "[spotifyFlow] preview proxy returned non-audio content-type:",
                    contentType
                  );
                }
              } else {
                console.log(
                  "[spotifyFlow] preview unavailable from proxy; status:",
                  ares && ares.status
                );
              }
            }
          } catch (audioErr) {
            console.warn(
              "[spotifyFlow] error fetching/sending preview audio:",
              audioErr && audioErr.message ? audioErr.message : audioErr
            );
          }
        }
      } catch (e) {
        await ctx.reply(
          "❌ Erro ao consultar tocando agora: " + (e.message || e)
        );
      }
      return { end: false };
    },

    todosMenu: async (ctx) => {
      try {
        // Try to fetch chat participants
        let memberIds = [];
        try {
          const chat = await ctx.client.getChatById(ctx.chatId);
          if (chat && Array.isArray(chat.participants)) {
            memberIds = chat.participants.map((p) => p.id._serialized);
          }
        } catch (e) {
          // fallback: empty member list
          memberIds = [];
        }

        const listenersRes = await backendClient.sendToBackend(
          `/api/groups/${encodeURIComponent(ctx.chatId)}/active-listeners`,
          { memberIds },
          "POST"
        );

        if (!listenersRes || !Array.isArray(listenersRes.listeners)) {
          await ctx.reply("⚠️ Erro ao consultar ouvintes. Tente novamente.");
          return { end: false };
        }

        const listeners = listenersRes.listeners;
        const anyPlaying = (listeners || []).some(
          (l) => l && l.currentTrack && l.currentTrack.isPlaying
        );
        if (!anyPlaying) {
          await ctx.reply(
            "Nenhum usuário do grupo está ouvindo músicas no momento"
          );
          return { end: false };
        }

        const byTrack = new Map();
        const notPlaying = [];

        for (const l of listeners) {
          const who = l.displayName || l.identifier || l.userId || "Usuário";
          const t = l.currentTrack;
          if (!t || !t.trackId || !t.trackName || !t.isPlaying) {
            notPlaying.push(who);
            continue;
          }

          const key = `${t.trackId}::${t.contextId || "noctx"}`;
          if (!byTrack.has(key)) byTrack.set(key, []);
          byTrack.get(key).push({ who, track: t });
        }

        const lines = [];
        lines.push("🎵 O que a galera está ouvindo:\n");

        function pct(track) {
          const p =
            track.progress_ms || track.progressMs || track.progress || 0;
          const d =
            track.duration_ms || track.durationMs || track.duration || 0;
          if (!p || !d) return null;
          return Math.round((p / d) * 100);
        }

        for (const [key, group] of byTrack.entries()) {
          if (group.length === 1) {
            const item = group[0];
            const t = item.track;
            const percent = pct(t);
            lines.push(`🎶 ${item.who}:`);
            lines.push(
              `   ${t.trackName} - ${
                Array.isArray(t.artists)
                  ? t.artists.join(", ")
                  : t.artists || ""
              }`
            );
            lines.push(`   ${percent !== null ? `⏱️ ${percent}%` : ""}`);
            lines.push("");
          } else {
            const percents = group.map((g) => ({
              who: g.who,
              pct: pct(g.track),
            }));
            const validPercs = percents
              .filter((p) => p.pct !== null)
              .map((p) => p.pct);
            let approx = "";
            if (validPercs.length > 0) {
              const avg = Math.round(
                validPercs.reduce((a, b) => a + b, 0) / validPercs.length
              );
              approx = `\n   ⏱️ ~${avg}%`;
            }

            const names = group
              .map((g) => g.who)
              .slice(0, 3)
              .join(" e ");
            const t = group[0].track;
            lines.push(`🎵 JAM Coletiva (${names}):`);
            lines.push(
              `   ${t.trackName} - ${
                Array.isArray(t.artists)
                  ? t.artists.join(", ")
                  : t.artists || ""
              }${approx}`
            );
            lines.push("");
          }
        }

        if (notPlaying.length > 0) {
          lines.push(`⏸️ Sem música: ${notPlaying.join(", ")}`);
        }

        const finalMsg = lines.join("\n");
        await ctx.client.sendMessage(ctx.chatId, finalMsg);

        // send composite sticker after text
        try {
          const tracksArr = Array.from(byTrack.values())
            .map((g) => g[0].track)
            .filter(Boolean)
            .slice(0, 9);
          if (tracksArr.length > 0) {
            const ok = await sendCompositeSticker(
              ctx.client,
              ctx.chatId,
              tracksArr
            );
            if (!ok)
              console.info(
                "[spotifyFlow] sendCompositeSticker failed after text"
              );
          }
        } catch (e) {
          console.error(
            "[spotifyFlow] error sending composite sticker after text:",
            e && e.message ? e.message : e
          );
        }
      } catch (e) {
        await ctx.reply(
          "❌ Erro ao executar Todos: " + (e && e.message ? e.message : e)
        );
      }
      return { end: false };
    },

    historyRelative: async (ctx, data) => {
      try {
        const days = data?.days || 7;
        const to = new Date();
        const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const resolved = await resolveUserUuid(ctx.userId);
        const userParam = resolved || ctx.userId;

        const isGroup = !!(
          ctx &&
          ctx.chatId &&
          String(ctx.chatId).endsWith("@g.us")
        );

        // pagination helper: fetch and display a page, then create poll to navigate
        async function renderPage(page = 1) {
          const url = `${BACKEND_URL}/api/spotify/history?userId=${encodeURIComponent(
            userParam
          )}&from=${from.toISOString()}&to=${to.toISOString()}&limit=10&page=${page}${
            isGroup ? "&scope=group" : ""
          }`;

          const res = await fetch(url, { method: "GET" });
          const json = await res.json();
          if (!json || !json.items || json.items.length === 0) {
            await ctx.reply("📭 Nenhuma reprodução encontrada neste período.");
            return { totalPages: 0 };
          }

          let reply = `📜 Histórico — últimos ${days} dias (página ${json.page} de ${json.totalPages}):\n`;
          for (const p of json.items) {
            reply += `\n• ${p.track.name} — ${
              Array.isArray(p.track.artists)
                ? p.track.artists.join(", ")
                : p.track.artists
            } \n  tocado: ${new Date(p.startedAt).toLocaleString()}\n`;
          }

          await ctx.reply(reply);

          // If multiple pages, create a small navigation poll (only the requester can navigate)
          if (json.totalPages && json.totalPages > 1) {
            const opts = [];
            if (page > 1) opts.push("◀️ Anterior");
            if (page < json.totalPages) opts.push("▶️ Próxima");
            opts.push("✖️ Fechar");

            try {
              await polls.createPoll(
                ctx.client,
                ctx.chatId,
                `Histórico — Navegação (página ${page})`,
                opts,
                {
                  onVote: async (payload) => {
                    // only allow the original requester to navigate
                    const voter = payload.voter;
                    if (voter !== ctx.userId) return;
                    const sel = (payload.selectedIndexes || [])[0];
                    const selected = sel != null ? opts[sel] : null;
                    if (!selected) return;

                    if (selected === "◀️ Anterior") {
                      await renderPage(Math.max(1, page - 1));
                    } else if (selected === "▶️ Próxima") {
                      await renderPage(Math.min(json.totalPages, page + 1));
                    } else {
                      // Close - do nothing
                    }
                  },
                }
              );
            } catch (e) {
              console.error(
                "[spotifyFlow] failed to create history navigation poll:",
                e && e.message ? e.message : e
              );
            }
          }

          return { totalPages: json.totalPages };
        }

        await renderPage(1);
      } catch (e) {
        await ctx.reply("❌ Erro ao consultar histórico: " + (e.message || e));
      }
      return { end: false };
    },

    stats: async (ctx, data) => {
      try {
        const resolved = await resolveUserUuid(ctx.userId);
        const userParam = resolved || ctx.userId;
        const isGroup = !!(
          ctx &&
          ctx.chatId &&
          String(ctx.chatId).endsWith("@g.us")
        );
        const period = data && data.period;
        const days =
          data && typeof data.days !== "undefined" && data.days !== null
            ? data.days
            : 7;
        let url = `${BACKEND_URL}/api/spotify/stats?userId=${encodeURIComponent(
          userParam
        )}`;

        let displayLabel = null;
        if (period === "month") {
          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          url += `&from=${encodeURIComponent(monthStart.toISOString())}`;
          url += `&to=${encodeURIComponent(new Date().toISOString())}`;
          displayLabel = "Esse mês";
        } else {
          if (days && Number(days) > 0) url += `&days=${Number(days)}`;
          displayLabel =
            days && Number(days) > 0 ? `últimos ${days} dias` : `Geral`;
        }

        if (isGroup) url += `&scope=group`;

        // Send the human-friendly display label as `period` so backend echoes it
        // exactly as the user selected (e.g., "Esse mês", "Últimos 7 dias").
        if (displayLabel) url += `&period=${encodeURIComponent(displayLabel)}`;

        const res = await fetch(url, { method: "GET" });
        const json = await res.json();
        console.log(`[spotifyFlow] Período selecionado: ${displayLabel}`);
        console.log(
          `[spotifyFlow] Período recebido (raw from backend): ${
            json && json.period
          }`
        );
        if (!json) {
          await ctx.reply("❌ Erro ao obter estatísticas.");
          return { end: false };
        }

        // Helpers
        function fmtDuration(ms) {
          const totalMin = Math.floor(ms / 60000);
          return totalMin;
        }

        // Activity bars
        const maxCount = Math.max(
          ...(json.activity || []).map((d) => d.count),
          1
        );
        function bar(count, width = 10) {
          const filled = Math.round((count / maxCount) * width);
          const empty = width - filled;
          return "█".repeat(filled) + "░".repeat(empty);
        }

        const lines = [];
        lines.push(`🎵 Seu Resumo Musical — ${displayLabel}`);
        lines.push("");

        // General stats
        const sum = json.summary || {};
        lines.push(`📊 Estatísticas Gerais`);
        lines.push(`🎵 Total: ${sum.totalPlays || 0} músicas`);
        lines.push(`🆔 Únicas: ${sum.uniqueTracks || 0}`);
        lines.push(`⏱️ Tempo: ${fmtDuration(sum.totalListenMs || 0)}`);
        lines.push("");

        // Activity
        lines.push(`📈 Atividade — ${displayLabel}:`);
        for (const d of json.activity || []) {
          lines.push(`${d.day} ${bar(d.count)} (${d.count})`);
        }
        lines.push("");

        // Heading suffix for period-sensitive labels
        let headingSuffix;
        if (period === "month") headingSuffix = "deste mês";
        else if (days && Number(days) === 7) headingSuffix = "desta semana";
        else if (days && Number(days) > 1)
          headingSuffix = `dos últimos ${days} dias`;
        else headingSuffix = "Geral";

        // Top artists
        if (json.topArtists && json.topArtists.length) {
          lines.push(`🎤 Top artistas ${headingSuffix}:`);
          json.topArtists.slice(0, 10).forEach((a, i) => {
            const medal =
              i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
            lines.push(`${medal} ${a.name} (${a.count}x)`);
          });
          lines.push("");
        }

        // Discoveries
        if (json.discoveries && json.discoveries.length) {
          lines.push(`✨ Descobertas recentes:`);
          json.discoveries.slice(0, 5).forEach((d) => {
            const whenMin = Math.round((d.whenMs || 0) / 60000);
            const track = d.track || {};
            lines.push(
              `* ${track.name || "Desconhecida"} - ${
                Array.isArray(track.artists)
                  ? track.artists.join(", ")
                  : track.artists || ""
              } (${whenMin}min atrás)`
            );
          });
          lines.push("");
        }

        // Repeats
        if (json.repeats && json.repeats.length) {
          lines.push(`🔁 Em repeat ${headingSuffix}:`);
          json.repeats.slice(0, 10).forEach((r) => {
            const t = r.track || {};
            lines.push(`* ${t.name || r.id || "Desconhecida"} (${r.count}x)`);
          });
          lines.push("");
        }

        // Time of day
        if (json.timeOfDay) {
          lines.push(`⏱️ Seus horários de escuta:`);
          lines.push(`* Manhã (6-12h): ${json.timeOfDay.morning}%`);
          lines.push(
            `* Tarde (12-18h): ${json.timeOfDay.afternoon}%` +
              (json.timeOfDay.afternoon >= 35 ? " ⭐" : "")
          );
          lines.push(`* Noite (18-24h): ${json.timeOfDay.evening}%`);
          lines.push(`* Madrugada (0-6h): ${json.timeOfDay.night}%`);
          lines.push("");
        }

        // Last 3
        if (json.last3 && json.last3.length) {
          lines.push(`🎶 Últimas ${json.last3.length} músicas:`);
          json.last3.forEach((r, idx) => {
            const whenMin = Math.round((r.whenMs || 0) / 60000);
            const t = r.track || {};
            lines.push(
              `${idx + 1}. ${t.name || "Desconhecida"} - ${
                Array.isArray(t.artists)
                  ? t.artists.join(", ")
                  : t.artists || ""
              } (${whenMin}min atrás)`
            );
          });
        }

        const final = lines.join("\n");

        // Try to render and send an image card; fallback to text on error
        try {
          const maxActivityCount = Math.max(
            ...(json.activity || []).map((x) => x.count),
            1
          );

          function formatPeriodLabel(p) {
            if (!p) return "Esse mês";
            const low = String(p).toLowerCase();
            if (
              low === "7d" ||
              low.includes("7") ||
              low.includes("7 dias") ||
              low.includes("últimos 7")
            )
              return "Últimos 7 dias";
            if (
              low === "30d" ||
              low.includes("30") ||
              low.includes("30 dias") ||
              low.includes("últimos 30")
            )
              return "Últimos 30 dias";
            if (
              low === "90d" ||
              low.includes("90") ||
              low.includes("90 dias") ||
              low.includes("últimos 90")
            )
              return "Últimos 90 dias";
            if (
              low === "all" ||
              low === "overall" ||
              low.includes("geral") ||
              low.includes("todos")
            )
              return "Geral";
            // month-like value (YYYY-MM) or explicit month string -> use as-is
            if (/^\d{4}-\d{2}$/.test(String(p))) return "Esse mês";
            return p;
          }

          // Use the display label derived from the selected option (no fallback to hardcoded "Esse mês")
          const templateData = {
            period: displayLabel,
            total: sum.totalPlays || 0,
            unique: sum.uniqueTracks || 0,
            time: fmtDuration(sum.totalListenMs || 0),
            albumImages: json.topAlbumImages || [],
            bars: (json.activity || []).map((d) => {
              const percent = Math.round(
                ((d.count || 0) / maxActivityCount) * 100
              );
              return {
                label: d.day || d.label || "",
                height: d.count || 0,
                percent,
              };
            }),
            top3: (json.topArtists || [])
              .slice(0, 3)
              .map((a) => ({ name: a.name, plays: a.count || 0 })),
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
            repeat: (json.repeats || []).slice(0, 3).map((r) => ({
              song: (r.track && r.track.name) || r.id || "Desconhecida",
              artist:
                r.track && Array.isArray(r.track.artists)
                  ? r.track.artists.join(", ")
                  : (r.track && r.track.artists) || "",
              plays: r.count || r.plays || r.playCount || 0,
            })),
            segments: {
              morning: json.timeOfDay?.morning || 0,
              afternoon: json.timeOfDay?.afternoon || 0,
              night: json.timeOfDay?.evening || 0,
              dawn: json.timeOfDay?.night || 0,
            },
            discoveries: (json.discoveries || []).slice(0, 3).map((d) => ({
              title: (d.track && d.track.name) || d.name || "Desconhecida",
              artist:
                d.track && Array.isArray(d.track.artists)
                  ? d.track.artists.join(", ")
                  : (d.track && d.track.artists) || "",
            })),
            lastTracks: (json.last3 || []).slice(0, 3).map((r) => ({
              title: r.track?.name || r.name || "",
              artist: Array.isArray(r.track?.artists)
                ? r.track.artists.join(", ")
                : r.track?.artists || "",
            })),
          };

          const img = await renderCard(templateData, {
            width: 746,
            height: 900,
            outputWidth: 746,
          });
          const { MessageMedia } = require("whatsapp-web.js");
          const media = new MessageMedia("image/png", img.toString("base64"));
          await ctx.client.sendMessage(ctx.chatId, media, { caption: "" });
        } catch (e) {
          await ctx.reply(final);
        }
      } catch (e) {
        await ctx.reply(
          "❌ Erro ao obter estatísticas: " + (e && e.message ? e.message : e)
        );
      }
      return { end: false };
    },

    showMonth: async (ctx, data) => {
      try {
        const month = data?.month;
        if (!month) {
          await ctx.reply("Mês inválido");
          return { end: false };
        }
        const resolved = await resolveUserUuid(ctx.userId);
        const userParam = resolved || ctx.userId;
        const isGroup = !!(
          ctx &&
          ctx.chatId &&
          String(ctx.chatId).endsWith("@g.us")
        );
        const url = `${BACKEND_URL}/api/spotify/summary?userId=${encodeURIComponent(
          userParam
        )}&month=${encodeURIComponent(month)}${isGroup ? "&scope=group" : ""}`;
        const res = await fetch(url, { method: "GET" });
        const json = await res.json();
        if (!json) {
          await ctx.reply("Nenhum dado para esse mês.");
          return { end: false };
        }

        let reply = `📅 Resumo — ${month}:\n`;
        reply += `• Total tocado: ${Math.floor(
          (json.totalMs || 0) / 60000
        )} min\n`;
        reply += `• Plays: ${json.playCount || 0}\n`;
        if (json.topTracks && json.topTracks.length) {
          reply += `\nTop faixas:\n`;
          json.topTracks.slice(0, 5).forEach((t, i) => {
            reply += `${i + 1}. ${t.name} — ${
              Array.isArray(t.artists) ? t.artists.join(", ") : t.artists
            } (${t.totalMinutes} min)\n`;
          });
        }

        await ctx.reply(reply);
      } catch (e) {
        await ctx.reply("❌ Erro ao obter resumo mensal: " + (e.message || e));
      }
      return { end: false };
    },

    exit: async (ctx) => {
      await ctx.reply("👋 Saindo do Spotify menu.");
      return { end: true };
    },
  },
});

module.exports = spotifyFlow;
