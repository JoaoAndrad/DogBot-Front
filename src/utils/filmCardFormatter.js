/**
 * Format film card message for /filme and film-search flow.
 * Uses UTC-3 (America/Sao_Paulo) for dates.
 */

const UTC3 = "America/Sao_Paulo";

/** Formata nota 0–5: sem decimal quando inteiro (5.0 → "5", 4.5 → "4.5"). */
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
 * Build the film card text (title, TMDb, assistido por / nota de cada usuário, overview).
 * @param {object} movieInfo - From getMovieInfoWithAllRatings: title, year, voteAverage, overview, ratings[];
 *   or getMovieInfo: userRating, userDisplayName, viewings (legacy single-user)
 * @returns {string}
 */
function formatFilmCardMessage(movieInfo) {
  const title = `*${movieInfo.title}*`;
  const year = movieInfo.year ? ` (${movieInfo.year})` : "";
  const rating = movieInfo.voteAverage
    ? `⭐ *TMDb:* ${formatRatingValue(movieInfo.voteAverage / 2)}/5`
    : "⭐ *TMDb:* N/A";
  const usersAvgLine =
    movieInfo.usersAverage != null
      ? `⭐ *Média dos usuários:* ${formatRatingValue(movieInfo.usersAverage)}/5`
      : "";
  const overview = movieInfo.overview ? movieInfo.overview : "";

  let statusLines;
  const ratingsList = movieInfo.ratings;
  if (ratingsList && Array.isArray(ratingsList) && ratingsList.length > 0) {
    statusLines = ratingsList
      .filter((r) => r.watched)
      .map((r) => {
        const displayName = (r.displayName || "Usuário").replace(/"/g, '\\"');
        const dateStr = formatDateUTC3(r.ratedAt || r.watchedAt);
        const noteStr =
          r.rating != null
            ? `👤 *Nota:* ${"⭐".repeat(Math.round(r.rating))} (${formatRatingValue(r.rating)}/5) (${dateStr})`
            : `👤 *Nota:* Sem avaliação (${dateStr})`;
        return `✅ Assistido por "${displayName}" | ${noteStr}`;
      })
      .join("\n");
    if (!statusLines) {
      statusLines = "❌ *Ninguém assistiu ainda*";
    }
  } else {
    const ur = movieInfo.userRating || {};
    const watched = ur.watched;
    const displayName =
      (movieInfo.userDisplayName || "Você").replace(/"/g, '\\"') || "Você";
    const ratingVal = ur.rating;
    const ratedAt = ur.ratedAt;
    const watchedAt = ur.watchedAt;
    if (!watched) {
      statusLines = "❌ *Não assistido* | 👤 *Sua nota:* Sem avaliação";
    } else {
      const dateStr = formatDateUTC3(ratedAt || watchedAt);
      const noteStr =
        ratingVal != null
          ? `👤 *Nota:* ${"⭐".repeat(Math.round(ratingVal))} (${formatRatingValue(ratingVal)}/5) (${dateStr})`
          : `👤 *Nota:* Sem avaliação (${dateStr})`;
      statusLines = `✅ Assistido por "${displayName}" | ${noteStr}`;
    }
  }

  let message = `📽️ ${title}${year}

${rating}${usersAvgLine ? "\n" + usersAvgLine : ""}
${statusLines}
`;
  const viewings = movieInfo.viewings || [];
  if (viewings.length > 0 && !ratingsList) {
    const lines = viewings.map((v) => {
      const d = formatDateUTC3(v.viewedAt);
      return v.source === "rate" ? `${d} (avaliado)` : d;
    });
    message += "\n" + lines.join("\n") + "\n";
  }
  message += "\n" + overview;
  return message;
}

module.exports = {
  formatFilmCardMessage,
  formatDateUTC3,
};
