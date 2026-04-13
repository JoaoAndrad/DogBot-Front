"use strict";

const backendClient = require("../../services/backendClient");
const logger = require("../logger");

/**
 * Extrai JID canónico (@c.us / @lid) a partir de um contacto wwebjs.
 * @param {import("whatsapp-web.js").Contact} contact
 * @returns {string|null}
 */
function jidFromContact(contact) {
  if (!contact) return null;
  const ser = contact.id && contact.id._serialized;
  if (ser && String(ser).includes("@")) {
    return String(ser).trim();
  }
  const n = contact.number;
  if (n != null && String(n).trim()) {
    const digits = String(n).replace(/\D/g, "");
    if (digits.length >= 8) return `${digits}@c.us`;
  }
  return ser ? String(ser).trim() : null;
}

/**
 * GET /api/users/lookup — resposta normalizada para o bot.
 * @param {string} identifier
 * @returns {Promise<object|null>}
 */
async function lookupByIdentifier(identifier) {
  if (identifier == null || String(identifier).trim() === "") return null;
  try {
    const raw = await backendClient.sendToBackend(
      `/api/users/lookup?identifier=${encodeURIComponent(String(identifier).trim())}`,
      null,
      "GET",
    );
    return raw || null;
  } catch (err) {
    logger.warn(
      `[getUserData] lookupByIdentifier falhou (${String(identifier).slice(0, 40)}…): ${err.message}`,
    );
    return null;
  }
}

/**
 * Tenta resolver LID → telefone/JID quando a API existir na fork do wwebjs.
 * @param {import("whatsapp-web.js").Client} client
 * @param {string} rawId
 * @returns {Promise<string|null>}
 */
async function normalizeIdentifierForLookup(client, rawId) {
  if (!client || !rawId) return null;
  const s = String(rawId).trim();
  if (!s.includes("@lid")) return null;
  if (typeof client.getContactLidAndPhone !== "function") return null;
  try {
    const result = await client.getContactLidAndPhone(s);
    if (typeof result === "string" && result.includes("@")) {
      return result.trim();
    }
    if (result && result.wid && result.wid._serialized) {
      return String(result.wid._serialized).trim();
    }
    const phone =
      result &&
      (result.phoneNumber ||
        result.phone ||
        (result.user && result.user.split("@")[0]));
    if (phone) {
      const digits = String(phone).replace(/\D/g, "");
      if (digits.length >= 8) return `${digits}@c.us`;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Encadeia contacto WA + lookup: caminho principal e fallbacks.
 * @param {import("whatsapp-web.js").Client} client
 * @param {string} waId JID ou id de participante
 * @param {{ message?: import("whatsapp-web.js").Message }} [opts]
 */
async function resolveUserLookup(client, waId, opts = {}) {
  const { message } = opts;
  const tried = new Set();
  /** @type {string[]} */
  const candidates = [];

  function pushCand(j) {
    if (!j) return;
    const x = String(j).trim();
    if (!x || tried.has(x)) return;
    tried.add(x);
    candidates.push(x);
  }

  if (message && typeof message.getContact === "function") {
    try {
      const c = await message.getContact();
      pushCand(jidFromContact(c));
    } catch (_) {
      /* ignore */
    }
  }

  const raw = String(waId || "").trim();
  pushCand(raw);

  if (client && raw) {
    try {
      const c = await client.getContactById(raw);
      pushCand(jidFromContact(c));
    } catch (_) {
      /* ignore */
    }
  }

  for (const id of candidates) {
    const res = await lookupByIdentifier(id);
    if (res && res.found) return res;
  }

  const norm = client ? await normalizeIdentifierForLookup(client, raw) : null;
  if (norm && !tried.has(norm)) {
    const res = await lookupByIdentifier(norm);
    if (res && res.found) return res;
  }

  return await lookupByIdentifier(raw);
}

/**
 * Um participante do grupo: getContactById → JID → lookup + fallbacks.
 * @param {import("whatsapp-web.js").Client} client
 * @param {string} memberId
 */
async function lookupMemberIdentifier(client, memberId) {
  const id = String(memberId || "").trim();
  if (!id) return { id, res: null };

  const tryIds = [];
  const seen = new Set();

  function push(idStr) {
    if (!idStr || seen.has(idStr)) return;
    seen.add(idStr);
    tryIds.push(idStr);
  }

  if (client) {
    try {
      const c = await client.getContactById(id);
      const j = jidFromContact(c);
      if (j) push(j);
    } catch (_) {
      /* ignore */
    }
  }

  push(id);

  for (const tid of tryIds) {
    const res = await lookupByIdentifier(tid);
    if (res && res.found) return { id, res };
  }

  if (client) {
    const norm = await normalizeIdentifierForLookup(client, id);
    if (norm && !seen.has(norm)) {
      const res = await lookupByIdentifier(norm);
      if (res && res.found) return { id, res };
    }
  }

  const res = await lookupByIdentifier(id);
  return { id, res };
}

/**
 * @param {import("whatsapp-web.js").Client} client
 * @param {string[]} memberIds
 * @param {{ concurrency?: number }} [_opts]
 */
async function lookupManyIdentifiers(client, memberIds, _opts = {}) {
  const ids = Array.isArray(memberIds) ? memberIds : [];
  const results = await Promise.all(
    ids.map((mid) => lookupMemberIdentifier(client, mid)),
  );
  return results;
}

/**
 * @param {Array<{ id: string, res: object|null }>} lookupResults
 */
function buildSpotifyEligibleMembers(lookupResults) {
  return (lookupResults || [])
    .filter(({ res }) => res && res.found && res.hasSpotify)
    .map(({ id, res }) => {
      const identifier = res.identifier || id;
      return {
        identifier,
        userId: res.userId,
        displayName: res.displayName || null,
      };
    });
}

/**
 * Nome para exibir: displayName (API) → pushname/nome WA → número → id curto.
 * Alinhado a usuario-display-name-preferencia (display_name antes de push).
 *
 * @param {object} params
 * @param {import("whatsapp-web.js").Client|null} params.client
 * @param {{ displayName?: string|null, identifier?: string|null, userId?: string }} [params.memberRow]
 * @param {string} params.userId
 */
async function resolveDisplayLabel({ client, memberRow, userId }) {
  if (!userId) return "?";
  const m = memberRow || {};
  if (m.displayName && String(m.displayName).trim()) {
    return String(m.displayName).trim();
  }
  if (client && m.identifier) {
    try {
      const c = await client.getContactById(m.identifier);
      const w = (c && (c.pushname || c.name || c.shortName)) || null;
      if (w && String(w).trim()) return String(w).trim();
    } catch (_) {
      /* ignore */
    }
  }
  if (m.identifier) {
    const num = String(m.identifier).split("@")[0];
    if (num) return num;
  }
  return String(userId).slice(0, 8);
}

/**
 * @param {Array<{ userId: string, identifier?: string, displayName?: string|null }>} spotifyMembers
 * @param {string} userId
 * @param {import("whatsapp-web.js").Client|null} client
 */
async function resolveVoterDisplayName(spotifyMembers, userId, client) {
  const m =
    spotifyMembers && spotifyMembers.find((x) => x.userId === userId);
  return resolveDisplayLabel({ client, memberRow: m, userId });
}

function displayNameForUserId(spotifyMembers, userId) {
  if (!spotifyMembers || !userId) return null;
  const m = spotifyMembers.find((x) => x.userId === userId);
  if (!m) return null;
  return (
    m.displayName || (m.identifier && m.identifier.split("@")[0]) || null
  );
}

/**
 * Mesmo JID que spotifyMembers[].identifier — menção real no grupo
 * (comando simulado pelo DogBubble não tem getContact()).
 */
function jidForMentionInitiator(
  spotifyMembers,
  initiatorUserId,
  whatsappIdFallback,
) {
  const row = spotifyMembers.find((m) => m.userId === initiatorUserId);
  if (row && row.identifier) return String(row.identifier).trim();
  const raw = String(whatsappIdFallback || "").trim();
  if (!raw) return null;
  if (raw.includes("@")) return raw;
  return `${raw}@c.us`;
}

function atTextFromJid(jid) {
  if (!jid) return "?";
  return `@${jid.split("@")[0]}`;
}

/**
 * Lookup de um JID de votante (ex. enquete), com resolução por contacto.
 * @param {import("whatsapp-web.js").Client} client
 * @param {string} voterJid
 */
async function lookupParticipant(client, voterJid) {
  return lookupMemberIdentifier(client, voterJid);
}

/**
 * Contexto inicial do comando voto: contacto WA + lookup do iniciador.
 * @param {{ message: import("whatsapp-web.js").Message, client: import("whatsapp-web.js").Client }} ctx
 */
async function createVotoUserContext({ message, client }) {
  let whatsappId = message.author || message.from;
  try {
    const contact = await message.getContact();
    const j = jidFromContact(contact);
    if (j) whatsappId = j;
  } catch (_) {
    whatsappId = message.author || message.from;
  }

  /** Já temos JID vindo de `getContact` acima; não repetir `message.getContact` em `resolveUserLookup`. */
  const initiatorLookup = await resolveUserLookup(client, whatsappId, {});

  return {
    whatsappId,
    initiatorLookup,
  };
}

module.exports = {
  jidFromContact,
  lookupByIdentifier,
  normalizeIdentifierForLookup,
  resolveUserLookup,
  lookupMemberIdentifier,
  lookupManyIdentifiers,
  buildSpotifyEligibleMembers,
  resolveDisplayLabel,
  resolveVoterDisplayName,
  displayNameForUserId,
  jidForMentionInitiator,
  atTextFromJid,
  lookupParticipant,
  createVotoUserContext,
};
