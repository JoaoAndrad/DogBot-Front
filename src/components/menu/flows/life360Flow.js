/**
 * Flow /life360 — só em grupo: enquete com membros mapeados (User.life360_member_id).
 */

const { createFlow } = require("../flowBuilder");
const life360Client = require("../../../services/life360Client");
const {
  memberIdsFromGroupChat,
} = require("../../../utils/whatsappParticipantIds");
const {
  sendBufferAsSticker,
  downloadImageToBuffer,
} = require("../../../utils/stickerHelper");
const logger = require("../../../utils/logger");
const { formatLife360PlaceLine } = require("../../../utils/life360PlaceFormat");

const MAX_MEMBERS = 10;

function truncateLabel(s, max = 120) {
  const t = String(s || "?")
    .replace(/\n/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function formatMemberName(m) {
  const parts = [m.firstName, m.lastName].filter(Boolean);
  return parts.length ? parts.join(" ") : "Membro";
}

/** Campos de localização a partir do objeto membro Life360. */
function locationPayloadFromMember(m) {
  const loc = (m && m.location) || {};
  return {
    latitude: loc.latitude,
    longitude: loc.longitude,
    name: loc.name,
    shortAddress: loc.shortAddress,
    address1: loc.address1,
    address2: loc.address2,
    battery: loc.battery,
    charge: loc.charge,
    since: loc.since,
    startTimestamp: loc.startTimestamp,
    endTimestamp: loc.endTimestamp,
    timestamp: loc.timestamp,
    isDriving: loc.isDriving,
    inTransit: loc.inTransit,
    speed: loc.speed,
    wifiState: loc.wifiState,
  };
}

function toUnixSeconds(t) {
  if (t == null || t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (n > 1e12) return Math.floor(n / 1000);
  return Math.floor(n);
}

/** Life360 costuma enviar velocidade em mph (0–120). Converte para km/h para exibição. */
function speedMphToKmh(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1.60934);
}

function formatTimeAtPlaceLine(loc) {
  const start = toUnixSeconds(loc.since) ?? toUnixSeconds(loc.startTimestamp);
  if (start == null) return null;
  const now = Math.floor(Date.now() / 1000);
  let delta = Math.max(0, now - start);
  const mins = Math.floor(delta / 60);
  if (mins < 1) return "⏱️ Neste local há menos de 1 min";
  if (mins < 60) return `⏱️ Neste local há ~${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `⏱️ Neste local há ~${hours} h`;
  const days = Math.floor(hours / 24);
  return `⏱️ Neste local há ~${days} dia(s)`;
}

function formatBatteryLine(loc) {
  const bat = loc.battery;
  if (bat == null || bat === "") return null;
  const pct = String(bat).replace(/%/g, "").trim();
  const charging =
    loc.charge === "1" || loc.charge === 1 || loc.charge === true;
  let line = `🔋 ${pct}%`;
  if (charging) line += " · Carregando";
  return line;
}

function formatMovementLine(loc) {
  /** Sem lugar/endereço/coordenadas na API — localização não partilhada (modo fantasma). */
  const sharingLocation = formatLife360PlaceLine(loc) != null;
  const stationary = () =>
    sharingLocation ? "🚶 Parado" : "👻 Desaparecido";

  const speed = Number(loc.speed);
  const driving = loc.isDriving === "1" || loc.isDriving === true;
  const transit = loc.inTransit === "1" || loc.inTransit === true;
  const kmh = speedMphToKmh(speed);
  const moving = driving || transit || (Number.isFinite(speed) && speed > 1.5);
  if (!moving && (!Number.isFinite(speed) || speed <= 1.5)) {
    return stationary();
  }
  if (kmh != null && kmh > 0) {
    if (driving || transit) {
      return `🚗 Em deslocação · ~${kmh} km/h`;
    }
    return `🏃 Em movimento · ~${kmh} km/h`;
  }
  if (driving || transit) return "🚗 Em deslocação";
  return stationary();
}

/**
 * @param {object} data - displayName, location, avatar opcional
 */
function formatLocationMessage(data) {
  const name = data.displayName || "Membro";
  const loc = data.location || {};
  const lines = [`👤 *${name}*`];

  const place = formatLife360PlaceLine(loc);
  if (place) lines.push(`📌 ${place}`);

  const timeLine = formatTimeAtPlaceLine(loc);
  if (timeLine) lines.push(timeLine);

  const batLine = formatBatteryLine(loc);
  if (batLine) lines.push(batLine);

  lines.push(formatMovementLine(loc));

  if (loc.latitude != null && loc.longitude != null) {
    lines.push(
      `🗺️ https://maps.google.com/?q=${encodeURIComponent(`${loc.latitude},${loc.longitude}`)}`,
    );
  }

  return lines.join("\n");
}

function mergeMemberFromApi(data, apiMember) {
  if (!apiMember || !apiMember.id) return data;
  const locApi = locationPayloadFromMember(apiMember);
  const mergedLoc = { ...(data.location || {}) };
  for (const [k, v] of Object.entries(locApi)) {
    if (v !== undefined && v !== null && v !== "") mergedLoc[k] = v;
  }
  const apiAvatar =
    apiMember.avatar != null && String(apiMember.avatar).trim() !== ""
      ? String(apiMember.avatar).trim()
      : null;
  return {
    ...data,
    displayName: data.displayName || formatMemberName(apiMember),
    // GET Member traz o URL de avatar completo; a lista por vezes omite ou vem incompleto.
    avatar: apiAvatar || data.avatar,
    location: mergedLoc,
  };
}

const life360Flow = createFlow("life360", {
  root: {
    title: "Life360",
    dynamic: true,
    handler: async (ctx) => {
      const groupChatId =
        (ctx.state.context && ctx.state.context.groupChatId) ||
        (String(ctx.chatId || "").endsWith("@g.us") ? ctx.chatId : null);

      if (!groupChatId) {
        return {
          title:
            "⚠️ O comando /life360 só funciona em *grupos* WhatsApp. Use o comando num grupo.",
          skipPoll: true,
        };
      }

      let status;
      try {
        status = await life360Client.getStatus();
      } catch (e) {
        return {
          title:
            "❌ Não foi possível falar com o servidor Life360.\n\n" +
            (e.message || String(e)),
          skipPoll: true,
        };
      }

      if (!status.configured) {
        return {
          title:
            "⚠️ Life360 não está configurado no *servidor*.\n\n" +
            "Peça ao administrador para definir `LIFE360_USERNAME` e `LIFE360_PASSWORD` no ambiente do backend.",
          skipPoll: true,
        };
      }

      if (!status.authenticated) {
        return {
          title:
            "⚠️ Life360: login falhou no servidor.\n\n" +
            (status.last_error
              ? `Último erro: ${String(status.last_error).slice(0, 300)}`
              : "Verifique as credenciais no env do backend."),
          skipPoll: true,
        };
      }

      let memberIds =
        ctx.state.context &&
        Array.isArray(ctx.state.context.memberIds) &&
        ctx.state.context.memberIds.length
          ? ctx.state.context.memberIds
          : null;

      if (!memberIds) {
        let chat;
        try {
          chat = await ctx.client.getChatById(groupChatId);
        } catch (e) {
          return {
            title:
              "❌ Não foi possível carregar o grupo: " +
              (e.message || String(e)),
            skipPoll: true,
          };
        }
        memberIds = memberIdsFromGroupChat(chat);
      }

      let preview;
      try {
        preview = await life360Client.getGroupLinkedPreview(
          groupChatId,
          memberIds,
        );
      } catch (e) {
        const msg =
          e.status === 400 && e.body && e.body.error
            ? String(e.body.error)
            : e.message || String(e);
        return {
          title: "❌ " + msg,
          skipPoll: true,
        };
      }

      const items = preview.items || [];
      if (items.length === 0) {
        return {
          title:
            "Nenhum participante deste grupo tem *vínculo com o Life360* ou o membro não foi encontrado em *nenhum* círculo da conta.",
          skipPoll: true,
        };
      }

      const truncated = items.length > MAX_MEMBERS;
      const slice = items.slice(0, MAX_MEMBERS);
      const title = truncated
        ? `📍 Localização — membros mapeados (primeiros ${MAX_MEMBERS}):`
        : "📍 Localização — membros mapeados:";

      const options = slice.map((item) => {
        const m = item.member || {};
        const displayName = item.displayName || formatMemberName(m);
        const itemCircleId = item.circleId || null;
        return {
          label: truncateLabel(`👤 ${displayName}`),
          action: "exec",
          handler: "pickMember",
          data: {
            displayName,
            memberId: m.id || item.life360_member_id,
            circleId: itemCircleId,
            avatar: m.avatar,
            location: locationPayloadFromMember(m),
          },
        };
      });

      options.push({
        label: "🔙 Sair",
        action: "exec",
        handler: "leaveLife360",
      });

      return { title, options, skipPoll: false };
    },
  },

  "/members": {
    title: "Membros",
    dynamic: true,
    handler: async (ctx) => {
      const circleId = ctx.state.context && ctx.state.context.circleId;
      const circleName =
        (ctx.state.context && ctx.state.context.circleName) || "Círculo";

      if (!circleId) {
        return {
          title: "❌ Círculo não selecionado. Use /life360 de novo.",
          skipPoll: true,
        };
      }

      let members;
      try {
        members = await life360Client.getMembers(circleId);
      } catch (e) {
        return {
          title: "❌ Erro ao carregar membros: " + (e.message || String(e)),
          skipPoll: true,
        };
      }

      if (!Array.isArray(members) || members.length === 0) {
        return {
          title: `Nenhum membro em “${truncateLabel(circleName, 40)}”.`,
          skipPoll: true,
        };
      }

      const truncated = members.length > MAX_MEMBERS;
      const slice = members.slice(0, MAX_MEMBERS);
      const title =
        `Membros — ${truncateLabel(circleName, 50)}` +
        (truncated ? ` (primeiros ${MAX_MEMBERS})` : "");

      const options = slice.map((m) => {
        const displayName = formatMemberName(m);
        return {
          label: truncateLabel(`👤 ${displayName}`),
          action: "exec",
          handler: "pickMember",
          data: {
            displayName,
            memberId: m.id,
            circleId,
            avatar: m.avatar,
            location: locationPayloadFromMember(m),
          },
        };
      });

      options.push({ label: "🔙 Voltar aos círculos", action: "back" });

      return { title, options, skipPoll: false };
    },
  },

  handlers: {
    pickCircle: async (ctx, data) => {
      ctx.state.context = ctx.state.context || {};
      ctx.state.context.circleId = data.circleId;
      ctx.state.context.circleName = data.name;
      ctx.state.history.push("/");
      ctx.state.path = "/members";
    },

    pickMember: async (ctx, data) => {
      let merged = { ...data };
      let circleId =
        merged.circleId || (ctx.state.context && ctx.state.context.circleId);
      const memberId = merged.memberId;

      const displayNameForWait =
        merged.displayName && String(merged.displayName).trim()
          ? String(merged.displayName).trim()
          : "este membro";
      await ctx.reply(
        `Carregando dados da localização de *${displayNameForWait}*, um momento...`,
      );

      // Voto via processador costuma trazer só memberId + location — sem circleId/avatar. Resolve pelo backend.
      const needsResolve =
        memberId &&
        (!circleId ||
          !merged.avatar ||
          !String(merged.avatar).trim().startsWith("http"));
      if (needsResolve) {
        try {
          const resolved = await life360Client.resolveLife360Member(memberId);
          if (resolved && resolved.member) {
            merged = mergeMemberFromApi(merged, resolved.member);
            circleId = resolved.circleId || circleId;
          }
        } catch (e) {
          logger.warn(
            "[life360Flow] resolveLife360Member: " + (e.message || String(e)),
          );
        }
      }

      if (circleId && memberId) {
        try {
          const res = await life360Client.getMember(circleId, memberId);
          const m = res && res.member;
          if (m) merged = mergeMemberFromApi(merged, m);
        } catch (e) {
          /* mantém merge anterior */
        }
      }

      const text = formatLocationMessage(merged);
      await ctx.reply(text);

      const avatarUrl = merged.avatar && String(merged.avatar).trim();
      if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) {
        try {
          const buf = await downloadImageToBuffer(avatarUrl);
          if (buf && buf.length) {
            const ok = await sendBufferAsSticker(ctx.client, ctx.chatId, buf, {
              fullOnly: true,
              filename: "life360-avatar.webp",
            });
            logger.info(
              `[life360Flow] figurinha avatar memberId=${memberId} ok=${ok}`,
            );
          } else {
            logger.warn(
              `[life360Flow] downloadImageToBuffer vazio memberId=${memberId}`,
            );
          }
        } catch (e) {
          logger.warn(
            "[life360Flow] figurinha: " + (e.message || String(e)),
          );
        }
      } else {
        logger.info(
          `[life360Flow] sem URL de avatar após merge memberId=${memberId}`,
        );
      }

      return { end: true };
    },

    leaveLife360: async (ctx) => {
      await ctx.reply("👋 Life360 fechado.");
      return { end: true };
    },
  },
});

module.exports = life360Flow;
