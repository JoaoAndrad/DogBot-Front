/**
 * @param {string} raw
 * @returns {{ ok: boolean, anchorTimeMinutes?: number, reason?: string }}
 */
function parseRoutineTimePtBr(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return { ok: false, reason: "Horário vazio." };

  if (t === "meio dia" || t === "meio-dia" || t === "meiodia") {
    return { ok: true, anchorTimeMinutes: 12 * 60 };
  }

  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return { ok: false, reason: "Horário inválido." };
    return { ok: true, anchorTimeMinutes: h * 60 + min };
  }

  const m2 = t.match(/^(\d{1,2})[h:](\d{2})?$/);
  if (m2) {
    const h = Number(m2[1]);
    const min = m2[2] != null ? Number(m2[2]) : 0;
    if (h > 23 || min > 59) return { ok: false, reason: "Horário inválido." };
    return { ok: true, anchorTimeMinutes: h * 60 + min };
  }

  return { ok: false, reason: "Use HH:MM ou meio dia." };
}

module.exports = { parseRoutineTimePtBr };
