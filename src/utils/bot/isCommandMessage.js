"use strict";

/**
 * Deteta se o texto da mensagem é tratado como comando em handlers/index.js
 * (prefixo / ou !, ou "confissao" sem prefixo em DM). Usado pelo rate limit do pipeline.
 */

function normalizeCmdName(s) {
  if (!s) return "";
  try {
    return String(s)
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  } catch (e) {
    return String(s).trim().toLowerCase();
  }
}

/**
 * @param {object} info - context.info (legacy)
 * @param {object} msg - context.msg (whatsapp-web.js)
 * @param {boolean} isGroup
 * @returns {boolean}
 */
function isCommandMessage(info, msg, isGroup) {
  const body = String(
    info.body || msg.body || (msg._data && msg._data.caption) || "",
  ).trim();

  const skipCommandFromPrefix =
    msg.type === "location" ||
    info.type === "location" ||
    !!msg.location ||
    body.startsWith("/9j/");

  if (
    !skipCommandFromPrefix &&
    (body.startsWith("!") || body.startsWith("/"))
  ) {
    return true;
  }

  if (body.length) {
    const raw = body.split(/\s+/)[0];
    const normalized = normalizeCmdName(raw);
    if (normalized === "confissao" && !isGroup) {
      return true;
    }
  }

  return false;
}

module.exports = { isCommandMessage, normalizeCmdName };
