/**
 * Format book card for /livro and book-search flow (UTC-3).
 */

const UTC3 = "America/Sao_Paulo";

function formatRatingValue(n) {
  if (n == null || Number.isNaN(n)) return "";
  const num = Number(n);
  return num % 1 === 0 ? String(Math.round(num)) : num.toFixed(1);
}

function formatDateUTC3(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("pt-BR", {
    timeZone: UTC3,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * @param {object} bookInfo - from getBookInfoWithAllRatings
 */
function formatBookCardMessage(bookInfo) {
  const title = `*${bookInfo.title}*`;
  const year = bookInfo.year ? ` (${bookInfo.year})` : "";
  const workId = bookInfo.workId || "";
  const olLine = workId
    ? `📖 *Open Library:* https://openlibrary.org/works/${workId}`
    : "";
  const usersAvgLine =
    bookInfo.usersAverage != null
      ? `⭐ *Média dos usuários:* ${formatRatingValue(bookInfo.usersAverage)}/5`
      : "";

  const overview = bookInfo.overview ? bookInfo.overview : "";

  let statusLines;
  const ratingsList = bookInfo.ratings;
  if (ratingsList && Array.isArray(ratingsList) && ratingsList.length > 0) {
    statusLines = ratingsList
      .filter((r) => r.read || r.watched)
      .map((r) => {
        const displayName = (r.displayName || "Usuário").replace(/"/g, '\\"');
        const dateStr = formatDateUTC3(r.ratedAt || r.readAt || r.watchedAt);
        const noteStr =
          r.rating != null
            ? `👤 *Nota:* ${"⭐".repeat(Math.round(r.rating))} (${formatRatingValue(r.rating)}/5) (${dateStr})`
            : `👤 *Nota:* Sem avaliação (${dateStr})`;
        return `✅ Lido por "${displayName}" | ${noteStr}`;
      })
      .join("\n");
    if (!statusLines) {
      statusLines = "❌ *Ninguém marcou como lido ainda*";
    }
  } else {
    const ur = bookInfo.userRating || {};
    const read = ur.read ?? ur.watched;
    const displayName =
      (bookInfo.userDisplayName || "Você").replace(/"/g, '\\"') || "Você";
    const ratingVal = ur.rating;
    const ratedAt = ur.ratedAt;
    const readAt = ur.readAt || ur.watchedAt;
    if (!read) {
      statusLines = "❌ *Não lido* | 👤 *Sua nota:* Sem avaliação";
    } else {
      const dateStr = formatDateUTC3(ratedAt || readAt);
      const noteStr =
        ratingVal != null
          ? `👤 *Nota:* ${"⭐".repeat(Math.round(ratingVal))} (${formatRatingValue(ratingVal)}/5) (${dateStr})`
          : `👤 *Nota:* Sem avaliação (${dateStr})`;
      statusLines = `✅ Lido por "${displayName}" | ${noteStr}`;
    }
  }

  let message = `📖 ${title}${year}

${olLine}${usersAvgLine ? (olLine ? "\n" : "") + usersAvgLine : ""}
${statusLines}
`;
  const readings = bookInfo.readings || [];
  if (readings.length > 0 && !ratingsList) {
    const lines = readings.map((v) => {
      const d = formatDateUTC3(v.readAt);
      return v.source === "rate" ? `${d} (avaliado)` : d;
    });
    message += "\n" + lines.join("\n") + "\n";
  }
  message += "\n" + overview;
  return message;
}

module.exports = {
  formatBookCardMessage,
  formatDateUTC3,
};
