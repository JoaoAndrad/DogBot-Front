/**
 * Format film card message for /filme and film-search flow.
 * Uses UTC-3 (America/Sao_Paulo) for dates.
 */

const UTC3 = "America/Sao_Paulo";

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
 * Build the film card text (title, TMDb, assistido por / nota, overview, viewings).
 * @param {object} movieInfo - From getMovieInfo: title, year, voteAverage, overview, userRating, userDisplayName, viewings
 * @returns {string}
 */
function formatFilmCardMessage(movieInfo) {
  const title = `*${movieInfo.title}*`;
  const year = movieInfo.year ? ` (${movieInfo.year})` : "";
  const rating = movieInfo.voteAverage
    ? `⭐ *TMDb:* ${(movieInfo.voteAverage / 2).toFixed(1)}/5`
    : "⭐ *TMDb:* N/A";
  const overview = movieInfo.overview ? movieInfo.overview : "";

  const ur = movieInfo.userRating || {};
  const watched = ur.watched;
  const displayName =
    (movieInfo.userDisplayName || "Você").replace(/"/g, '\\"') || "Você";
  const ratingVal = ur.rating;
  const ratedAt = ur.ratedAt;
  const watchedAt = ur.watchedAt;

  let statusLine;
  if (!watched) {
    statusLine = "❌ *Não assistido* | 👤 *Sua nota:* Sem avaliação";
  } else {
    const dateStr = formatDateUTC3(ratedAt || watchedAt);
    const noteStr =
      ratingVal != null
        ? `👤 *Nota:* ${"⭐".repeat(Math.round(ratingVal))} (${ratingVal}/5) (${dateStr})`
        : `👤 *Nota:* Sem avaliação (${dateStr})`;
    statusLine = `✅ Assistido por "${displayName}" | ${noteStr}`;
  }

  let message = `📽️ ${title}${year}

${rating}
${statusLine}
`;
  const viewings = movieInfo.viewings || [];
  if (viewings.length > 0) {
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
