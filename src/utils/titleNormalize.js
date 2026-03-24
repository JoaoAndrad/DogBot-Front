/**
 * Normalização de títulos para listas/enquetes (sem acentos, minúsculas).
 */

function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Só o título (sem ano), para cartões e textos longos. */
function normalizeBookTitleDisplay(title) {
  return stripDiacritics(String(title || "").trim()).toLowerCase();
}

/** Título para lista/enquete: sem acento, minúsculas; ano e editora opcionais. */
function normalizeBookTitleForList(title, year, publisher) {
  const t = normalizeBookTitleDisplay(title);
  const y = year != null && String(year).trim() !== "" ? String(year).trim() : "";
  const pub =
    publisher != null && String(publisher).trim()
      ? stripDiacritics(String(publisher).trim()).toLowerCase()
      : "";
  let line = y ? `${t} (${y})` : t;
  if (pub) line += ` · ${pub}`;
  return line;
}

/** Limite seguro para opções de enquete no WhatsApp (evita texto vazio/truncado estranho). */
const POLL_OPTION_MAX_LEN = 100;

function truncateForPoll(text, maxLen = POLL_OPTION_MAX_LEN) {
  const s = String(text || "").trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen - 1).trim();
  return `${cut}…`;
}

module.exports = {
  stripDiacritics,
  normalizeBookTitleDisplay,
  normalizeBookTitleForList,
  truncateForPoll,
  POLL_OPTION_MAX_LEN,
};
