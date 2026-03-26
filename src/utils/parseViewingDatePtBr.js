/**
 * Parse de datas informadas pelo usuário (calendário em America/Sao_Paulo, UTC−3).
 * Retorna um Date (instante) ao meio-dia local SP para o dia civil escolhido.
 */

const SP_TZ = "America/Sao_Paulo";

function stripAccents(s) {
  return String(s)
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Partes Y-M-D do relógio civil em São Paulo */
function calendarPartsInSaoPaulo(date) {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date instanceof Date ? date : new Date(date));
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  return { y, m, d };
}

function shiftCalendarDays(y, m, d, delta) {
  const jd = new Date(Date.UTC(y, m - 1, d));
  jd.setUTCDate(jd.getUTCDate() + delta);
  return {
    y: jd.getUTCFullYear(),
    m: jd.getUTCMonth() + 1,
    d: jd.getUTCDate(),
  };
}

/** Meio-dia em São Paulo no dia civil (y,m,d) como instante UTC (BRT = UTC−3). */
function ymdToDateAtNoonSaoPaulo(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
}

function todayYmdInSp() {
  return calendarPartsInSaoPaulo(new Date());
}

/**
 * @param {string} raw
 * @returns {{ ok: true, date: Date } | { ok: false, reason: string }}
 */
function parseViewingDatePtBr(raw) {
  if (raw == null) {
    return { ok: false, reason: "Digite uma data." };
  }
  const t = String(raw).trim();
  if (!t) {
    return { ok: false, reason: "Digite uma data." };
  }

  const norm = stripAccents(t.toLowerCase());

  if (norm === "hoje") {
    const { y, m, d } = todayYmdInSp();
    return { ok: true, date: ymdToDateAtNoonSaoPaulo(y, m, d) };
  }
  if (norm === "ontem") {
    const { y, m, d } = todayYmdInSp();
    const p = shiftCalendarDays(y, m, d, -1);
    return { ok: true, date: ymdToDateAtNoonSaoPaulo(p.y, p.m, p.d) };
  }
  if (norm === "antes de ontem" || norm === "anteontem") {
    const { y, m, d } = todayYmdInSp();
    const p = shiftCalendarDays(y, m, d, -2);
    return { ok: true, date: ymdToDateAtNoonSaoPaulo(p.y, p.m, p.d) };
  }

  const m1 = t.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (m1) {
    const day = parseInt(m1[1], 10);
    const month = parseInt(m1[2], 10);
    let year = m1[3] != null && m1[3] !== "" ? parseInt(m1[3], 10) : null;
    if (year != null && year < 100) {
      year = year < 70 ? 2000 + year : 1900 + year;
    }
    if (year == null) {
      year = todayYmdInSp().y;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { ok: false, reason: "Dia ou mês inválido." };
    }
    const test = new Date(Date.UTC(year, month - 1, day));
    if (test.getUTCMonth() !== month - 1 || test.getUTCDate() !== day) {
      return { ok: false, reason: "Esta data não existe no calendário." };
    }
    return { ok: true, date: ymdToDateAtNoonSaoPaulo(year, month, day) };
  }

  return {
    ok: false,
    reason:
      'Use dia/mês/ano (ex: 12/08/26), só dia/mês (ex: 12/8), ou "hoje", "ontem", "antes de ontem".',
  };
}

function formatDateDdMmYyyy(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

module.exports = {
  parseViewingDatePtBr,
  formatDateDdMmYyyy,
  SP_TZ,
};
