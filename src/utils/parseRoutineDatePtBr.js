const { DateTime } = require("luxon");

/**
 * @param {string} raw
 * @param {string} zone default America/Sao_Paulo
 * @returns {{ ok: boolean, date?: Date, reason?: string }}
 */
function parseRoutineDatePtBr(raw, zone = "America/Sao_Paulo") {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return { ok: false, reason: "Data vazia." };

  const now = DateTime.now().setZone(zone).startOf("day");

  if (t === "hoje") return { ok: true, date: now.toJSDate() };
  if (t === "amanhã" || t === "amanha")
    return { ok: true, date: now.plus({ days: 1 }).toJSDate() };
  if (t === "depois de amanhã" || t === "depois de amanha")
    return { ok: true, date: now.plus({ days: 2 }).toJSDate() };

  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : now.year;
    if (y < 100) y += 2000;
    const dt = DateTime.fromObject(
      { year: y, month: mo, day: d },
      { zone },
    );
    if (!dt.isValid) return { ok: false, reason: "Data inválida." };
    return { ok: true, date: dt.startOf("day").toJSDate() };
  }

  return { ok: false, reason: "Use DD/MM/AAAA, hoje ou amanhã." };
}

module.exports = { parseRoutineDatePtBr };
