/**
 * NLP parser for free-form financial commands in Brazilian Portuguese.
 *
 * Returns null if the input doesn't match, or an object:
 * {
 *   intent: 'expense' | 'income' | 'future_expense' | 'future_income' | 'transfer'
 *   amount: number           (e.g. 50.00)
 *   description: string      (e.g. "uber")
 *   date: Date | null        (null = today; future = informed date)
 *   isPending: boolean       (status: 'pending' if future, else 'confirmed')
 *   raw: string              (original input)
 * }
 */

const AMOUNT_RE = /R?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i;

// How much / what / when patterns
const EXPENSE_TRIGGERS = /\b(gast[eouia]i?|paguei|debit[ao]u?|comprei|sa[íi]u|saiu|saindo|devo|tive que pagar)\b/i;
const INCOME_TRIGGERS  = /\b(recebi|entrou|recebendo|ganhei|me pagaram|depositaram|caiu)\b/i;
const FUTURE_MARKERS   = /\b(vou|vou pagar|pagarei|vou gastar|gastarei|amanhã|próxim[ao]|essa semana|próxima semana|daqui)\b/i;
const TRANSFER_TRIGGERS = /\b(transfer[ei]|transferindo|movi|movendo)\b/i;

// Date extraction
const TODAY_RE    = /\bhoje\b/i;
const YESTERDAY_RE = /\bontem\b/i;
const TOMORROW_RE  = /\bamanhã\b/i;
const DAY_RE       = /\b(dia\s+(\d{1,2})(?:\s*\/\s*(\d{1,2}))?)\b/i;
const WEEKDAY_MAP  = { segunda: 1, "segunda-feira": 1, terça: 2, "terça-feira": 2, quarta: 3, "quarta-feira": 3, quinta: 4, "quinta-feira": 4, sexta: 5, "sexta-feira": 5, sábado: 6, domingo: 0 };

function parseAmount(text) {
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  // Normalize: remove R$, spaces; handle comma as decimal separator
  let raw = m[1].replace(/\s/g, "");
  // If there are two separators, figure out which is thousands vs decimal
  const commaIdx = raw.lastIndexOf(",");
  const dotIdx   = raw.lastIndexOf(".");
  if (commaIdx > dotIdx) {
    // Comma is decimal separator: 1.500,50 → 1500.50
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (dotIdx > commaIdx && commaIdx !== -1) {
    // Dot is decimal separator: 1,500.50 → 1500.50
    raw = raw.replace(/,/g, "");
  } else {
    // Single separator — if last segment has ≤2 digits it's decimal
    raw = raw.replace(",", ".");
  }
  const val = parseFloat(raw);
  return isNaN(val) ? null : Math.abs(val);
}

function parseDate(text) {
  const now = new Date();
  if (TODAY_RE.test(text)) return now;
  if (YESTERDAY_RE.test(text)) { const d = new Date(now); d.setDate(d.getDate() - 1); return d; }
  if (TOMORROW_RE.test(text)) { const d = new Date(now); d.setDate(d.getDate() + 1); return d; }

  // "dia 15" or "dia 15/07"
  const dayMatch = text.match(DAY_RE);
  if (dayMatch) {
    const day  = parseInt(dayMatch[2], 10);
    const month = dayMatch[3] ? parseInt(dayMatch[3], 10) - 1 : now.getMonth();
    const d = new Date(now.getFullYear(), month, day);
    return d;
  }

  // Named weekday: "próxima segunda", "na sexta"
  for (const [name, dow] of Object.entries(WEEKDAY_MAP)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) {
      const d = new Date(now);
      const diff = (dow - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
  }

  return null; // caller defaults to today
}

function extractDescription(text) {
  // Remove triggers, amount, date words, filler words
  let desc = text
    .replace(AMOUNT_RE, "")
    .replace(/R?\$\s*/gi, "")
    .replace(/\b(gast[eouia]i?|paguei|debit[ao]u?|comprei|recebi|entrou|recebendo|ganhei|me pagaram|depositaram|caiu|transfer[ei]|transferindo|movi|movendo|vou|vou pagar|pagarei|vou gastar|gastarei)\b/gi, "")
    .replace(/\b(de|do|da|no|na|em|com|para|pra|um|uma|uns|umas|hoje|ontem|amanhã|dia|reais|real|brl)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return desc || null;
}

function parse(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();

  const amount = parseAmount(t);
  if (!amount) return null;

  const date = parseDate(t);
  const description = extractDescription(t);

  const isTransfer = TRANSFER_TRIGGERS.test(t);
  if (isTransfer) {
    return { intent: "transfer", amount, description, date, isPending: false, raw: t };
  }

  const isFuture = FUTURE_MARKERS.test(t) && !INCOME_TRIGGERS.test(t);
  const isIncome = INCOME_TRIGGERS.test(t);
  const isExpense = EXPENSE_TRIGGERS.test(t);

  if (!isIncome && !isExpense && !isFuture) return null;

  if (isFuture && isExpense) {
    return { intent: "future_expense", amount, description, date, isPending: true, raw: t };
  }
  if (isFuture && !isIncome) {
    return { intent: "future_expense", amount, description, date, isPending: true, raw: t };
  }
  if (isIncome) {
    return { intent: "income", amount, description, date, isPending: false, raw: t };
  }
  return { intent: "expense", amount, description, date, isPending: false, raw: t };
}

module.exports = { parse };
