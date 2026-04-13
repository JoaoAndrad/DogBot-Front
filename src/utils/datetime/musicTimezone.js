/**
 * Calendário de música alinhado a America/Sao_Paulo (UTC−3, sem DST).
 * O backend continua a receber instantes em ISO (UTC); aqui definimos início/fim de mês no fuso BR.
 */
const { DateTime } = require("luxon");

const MUSIC_TIMEZONE =
  process.env.MUSIC_TIMEZONE || "America/Sao_Paulo";

/**
 * Início do mês civil actual em SP e “agora” (fim do intervalo) para /stats “esse mês”.
 * @returns {{ from: Date, to: Date }}
 */
function musicCurrentMonthRangeToNowUtc() {
  const z = MUSIC_TIMEZONE;
  const from = DateTime.now().setZone(z).startOf("month").toUTC().toJSDate();
  const to = DateTime.now().setZone(z).toUTC().toJSDate();
  return { from, to };
}

/**
 * Intervalo [from, to) do mês yyyy-mm no calendário de São Paulo.
 * @param {string} ym — "YYYY-MM"
 * @returns {{ from: Date, to: Date }}
 */
function musicMonthRangeUtc(ym) {
  const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
  const start = DateTime.fromObject(
    { year: y, month: m, day: 1 },
    { zone: MUSIC_TIMEZONE },
  ).startOf("month");
  const end = start.plus({ months: 1 });
  return {
    from: start.toUTC().toJSDate(),
    to: end.toUTC().toJSDate(),
  };
}

/**
 * Últimos 12 meses (rótulo pt-BR + valor YYYY-MM) no calendário de SP.
 * @returns {{ label: string, ym: string }[]}
 */
function musicLast12MonthsChoices() {
  const z = MUSIC_TIMEZONE;
  const out = [];
  for (let i = 0; i < 12; i++) {
    const dt = DateTime.now().setZone(z).startOf("month").minus({ months: i });
    const ym = dt.toFormat("yyyy-MM");
    const label = dt.setLocale("pt-BR").toFormat("MMMM yyyy");
    out.push({ label, ym });
  }
  return out;
}

/**
 * Formata instante ISO/Date para texto em pt-BR no fuso de música (ex.: histórico no WhatsApp).
 * @param {string|number|Date} isoOrDate
 */
function formatPlaybackInstant(isoOrDate) {
  const d =
    isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: MUSIC_TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  });
}

module.exports = {
  MUSIC_TIMEZONE,
  musicCurrentMonthRangeToNowUtc,
  musicMonthRangeUtc,
  musicLast12MonthsChoices,
  formatPlaybackInstant,
};
