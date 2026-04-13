/**
 * Texto único para o “lugar” Life360 (alinhado entre /todos e /life360).
 * Com `location.name` (ex. Home, Trabalho): só o nome.
 * Sem nome: endereço o mais completo possível (shortAddress + address1/2 com dedupe).
 */

function norm(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeAddressParts(parts) {
  const cleaned = parts.map(norm).filter(Boolean);
  if (cleaned.length === 0) return "";
  const acc = [];
  for (const p of cleaned) {
    const pl = p.toLowerCase();
    let skip = false;
    for (let i = 0; i < acc.length; i++) {
      const a = acc[i];
      const al = a.toLowerCase();
      if (al.includes(pl) && a.length >= p.length) {
        skip = true;
        break;
      }
      if (pl.includes(al) && p.length >= a.length) {
        acc[i] = p;
        skip = true;
        break;
      }
    }
    if (!skip) acc.push(p);
  }
  return acc.join(", ");
}

/**
 * @param {object} loc - objeto location (name, shortAddress, address1, address2, lat/lng)
 * @returns {string|null} texto para exibir ou null
 */
function formatLife360PlaceLine(loc) {
  if (!loc) return null;

  const placeName = norm(loc.name);
  if (placeName) return placeName;

  const sa = norm(loc.shortAddress);
  const a1 = norm(loc.address1);
  const a2 = norm(loc.address2);

  if (sa && (sa.includes(",") || sa.includes(" - ") || sa.length >= 45)) {
    return sa;
  }

  const merged = mergeAddressParts([a1, a2, sa]);
  if (merged) return merged;

  if (loc.latitude != null && loc.longitude != null) {
    return `${loc.latitude}, ${loc.longitude}`;
  }
  return null;
}

module.exports = {
  formatLife360PlaceLine,
};
