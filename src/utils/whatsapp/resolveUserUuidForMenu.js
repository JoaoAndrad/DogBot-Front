const fetch = require("node-fetch");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * Alinha com movieFlow/bookFlow: votos/menu podem gravar estado com UUID, texto vem com @c.us
 * @param {string} externalId
 * @returns {Promise<string|null>}
 */
async function resolveUserUuidForMenu(externalId) {
  if (!externalId) return null;
  const s = String(externalId);
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ) {
    return s;
  }
  try {
    const url = `${BACKEND_URL}/api/users/by-identifier/${encodeURIComponent(
      externalId,
    )}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.user && json.user.id ? json.user.id : null;
  } catch (e) {
    return null;
  }
}

module.exports = resolveUserUuidForMenu;
