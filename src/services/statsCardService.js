const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const sharp = require("sharp");

const templatePath = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "stats-card.html",
);
const ratingsTemplatePath = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "stats-ratings-card.html",
);
const moviesTemplatePath = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "stats-movies-card.html",
);
const booksTemplatePath = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "stats-books-card.html",
);
const tplSrc = fs.readFileSync(templatePath, "utf8");
const tpl = Handlebars.compile(tplSrc);
const ratingsTplSrc = fs.readFileSync(ratingsTemplatePath, "utf8");
const ratingsTpl = Handlebars.compile(ratingsTplSrc);
const moviesTplSrc = fs.readFileSync(moviesTemplatePath, "utf8");
const moviesTpl = Handlebars.compile(moviesTplSrc);
const booksTplSrc = fs.readFileSync(booksTemplatePath, "utf8");
const booksTpl = Handlebars.compile(booksTplSrc);

// Register helper to display 1-based index
Handlebars.registerHelper("indexPlusOne", function (index) {
  return (parseInt(index, 10) || 0) + 1;
});

// Register helper for greater than comparison
Handlebars.registerHelper("gt", function (a, b) {
  return a > b;
});

// Register helper to format period with proper preposition
Handlebars.registerHelper("formatPeriod", function (period) {
  if (!period) return "no período";
  const p = String(period).toLowerCase();

  // Check for month names or "esse mês"
  const months = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const hasMonth = months.some((m) => p.includes(m));
  if (hasMonth || p.includes("esse mês")) {
    return `em ${period}`;
  }

  // Check for "últimos X dias"
  if (p.includes("últimos") || p.includes("ultimos")) {
    return `nos ${period}`;
  }

  // Check for "geral"
  if (p === "geral") {
    return "geral";
  }

  // Default
  return `no ${period}`;
});

let browserInstance = null;

/**
 * Viewport lógico (CSS px) para stats-card e stats-ratings-card — story 9:16.
 * - O Puppeteer multiplica pela deviceScaleFactor: com 2, o PNG costuma sair
 *   com largura ~2160px (1080×2), não 1080px.
 * - fullPage: true captura a altura total do documento; pode ser > 1920px se
 *   o conteúdo crescer (cada cartão pode ter altura de PNG diferente).
 */
const DEFAULT_CARD_VIEWPORT = {
  width: 1080,
  height: 1920,
  deviceScaleFactor: 2,
};

async function logPngDimensions(buffer, label, deviceScaleFactor) {
  const dpr =
    deviceScaleFactor != null
      ? deviceScaleFactor
      : DEFAULT_CARD_VIEWPORT.deviceScaleFactor;
  try {
    const meta = await sharp(buffer).metadata();
    console.log(
      `[${label}] PNG: ${meta.width}×${meta.height}px (DPR=${dpr})`,
    );
  } catch (e) {
    console.warn(`[${label}] Dimensões PNG:`, e && e.message ? e.message : e);
  }
}

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    console.log("[statsCard] Reutilizando instância de browser existente");
    return browserInstance;
  }

  console.log("[statsCard] Lançando nova instância de Puppeteer...");
  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  console.log("[statsCard] Browser lançado com sucesso");

  return browserInstance;
}

function formatPtDecimal(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return String(Number(n).toFixed(1)).replace(".", ",");
}

/** Nota no formato "9,6/10" (vírgula decimal, escala 0–10). */
function formatRatingSlash10(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—/10";
  const x = Number(n);
  const s = Number.isInteger(x)
    ? String(x)
    : x.toFixed(1).replace(".", ",");
  return `${s}/10`;
}

/** Nota escala 0–5 para o cartão de filmes */
function formatRatingSlash5(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—/5";
  const x = Number(n);
  const s = Number.isInteger(x)
    ? String(x)
    : x.toFixed(1).replace(".", ",");
  return `${s}/5`;
}

/**
 * Cinco posições: estrelas cheias (★) verdes; vazias (☆) cinza; meia = metade esquerda da ★.
 * Usa U+2605/U+2606 — o emoji ⭐ costuma virar caixa □ no Puppeteer/Chromium headless.
 */
function buildRatingStarsHtml5(rating) {
  if (rating == null || !Number.isFinite(Number(rating))) {
    return '<span class="movie-star-row movie-star-row--missing">—</span>';
  }
  const r = Math.max(0, Math.min(5, Number(rating)));
  const fullCount = Math.floor(r);
  const hasHalf = r - fullCount >= 0.5;
  const emptyCount = 5 - fullCount - (hasHalf ? 1 : 0);

  const parts = [];
  for (let i = 0; i < fullCount; i++) {
    parts.push(
      '<span class="movie-star movie-star--full" aria-hidden="true">\u2605</span>',
    );
  }
  if (hasHalf) {
    parts.push(
      '<span class="movie-star movie-star--half" aria-hidden="true">' +
        '<span class="movie-star-half-bg">\u2606</span>' +
        '<span class="movie-star-half-fg"><span class="movie-star-half-fg-inner">\u2605</span></span>' +
        "</span>",
    );
  }
  for (let i = 0; i < emptyCount; i++) {
    parts.push(
      '<span class="movie-star movie-star--empty" aria-hidden="true">\u2606</span>',
    );
  }
  return '<span class="movie-star-row">' + parts.join("") + "</span>";
}

/** Células sem poster no mosaico dos cartões de estatísticas */
const MOSAIC_EMPTY_COLOR = "#000";

/**
 * Índices 0–7 (cards 1–8) onde colocar as n primeiras imagens, espalhadas.
 * n=2 → cards 2 e 6; n=4 → cards 1,4,6,8 (plan).
 */
const MOSAIC_SCATTER_BY_COUNT = {
  1: [4],
  2: [1, 5],
  3: [0, 4, 7],
  4: [0, 3, 5, 7],
  5: [0, 2, 4, 5, 7],
  6: [0, 1, 3, 4, 5, 7],
  7: [0, 1, 2, 3, 4, 5, 6],
  8: [0, 1, 2, 3, 4, 5, 6, 7],
};

/**
 * @param {unknown[]} urls - URLs de poster/capa (máx. 8 usadas)
 * @returns {{ url: string|null, fallbackColor: string }[]}
 */
function buildMosaicTiles(urls) {
  const list = (Array.isArray(urls) ? urls : [])
    .map((u) => (u != null && String(u).trim() !== "" ? String(u).trim() : null))
    .filter(Boolean)
    .slice(0, 8);
  const n = list.length;
  const empty = () => ({ url: null, fallbackColor: MOSAIC_EMPTY_COLOR });
  const tiles = Array.from({ length: 8 }, empty);
  if (n === 0) return tiles;
  const slots = MOSAIC_SCATTER_BY_COUNT[n];
  if (!slots || slots.length !== n) {
    for (let i = 0; i < n; i++) tiles[i] = { url: list[i], fallbackColor: MOSAIC_EMPTY_COLOR };
    return tiles;
  }
  for (let i = 0; i < n; i++) {
    tiles[slots[i]] = { url: list[i], fallbackColor: MOSAIC_EMPTY_COLOR };
  }
  return tiles;
}

/**
 * Prepara payload do GET /api/movies/period-stats para stats-movies-card.html.
 * `data` pode incluir `periodDisplay` (rótulo) e `logoPath`.
 */
function normalizeMoviesTemplateData(data) {
  const summary = data.summary || {};
  const period =
    data.periodDisplay != null && String(data.periodDisplay).trim() !== ""
      ? String(data.periodDisplay).trim()
      : data.period != null
        ? String(data.period)
        : "período";
  const urls = Array.isArray(data.mosaicPosterUrls) ? data.mosaicPosterUrls : [];
  const mosaicTiles = buildMosaicTiles(urls);
  const filmsWatched =
    summary.filmsWatchedDistinct != null
      ? String(summary.filmsWatchedDistinct)
      : "0";
  const lastRated = (data.lastRated || []).map((r) => ({
    ...r,
    ratingSlash5: formatRatingSlash5(r.rating),
    ratingStarsHtml: buildRatingStarsHtml5(r.rating),
  }));
  const lastWatched = data.lastWatched || [];
  const statFilmsWatched =
    summary.filmsWatchedDistinct != null
      ? String(summary.filmsWatchedDistinct)
      : "0";
  const statRatings =
    summary.ratingsInPeriod != null ? String(summary.ratingsInPeriod) : "0";
  let statHours = "— h estimadas";
  if (
    summary.estimatedHours != null &&
    Number.isFinite(Number(summary.estimatedHours)) &&
    Number(summary.estimatedHours) > 0
  ) {
    const h = Number(summary.estimatedHours);
    const s = Number.isInteger(h)
      ? String(h)
      : h.toFixed(1).replace(".", ",");
    statHours = `~${s} h estimadas`;
  }
  return {
    ...data,
    period,
    mosaicTiles,
    filmsWatched,
    lastRated,
    lastWatched,
    statFilmsWatched,
    statRatings,
    statHours,
  };
}

/**
 * Prepara payload do GET /api/books/period-stats para stats-books-card.html.
 * `data` pode incluir `periodDisplay` (rótulo) e `logoPath`.
 */
function normalizeBooksTemplateData(data) {
  const summary = data.summary || {};
  const period =
    data.periodDisplay != null && String(data.periodDisplay).trim() !== ""
      ? String(data.periodDisplay).trim()
      : data.period != null
        ? String(data.period)
        : "período";
  const urls = Array.isArray(data.mosaicCoverUrls) ? data.mosaicCoverUrls : [];
  const mosaicTiles = buildMosaicTiles(urls);
  const booksRead =
    summary.booksReadDistinct != null
      ? String(summary.booksReadDistinct)
      : "0";
  const lastRated = (data.lastRated || []).map((r) => ({
    ...r,
    ratingSlash5: formatRatingSlash5(r.rating),
    ratingStarsHtml: buildRatingStarsHtml5(r.rating),
  }));
  const lastRead = data.lastRead || [];
  const statBooksRead =
    summary.booksReadDistinct != null
      ? String(summary.booksReadDistinct)
      : "0";
  const statRatings =
    summary.ratingsInPeriod != null ? String(summary.ratingsInPeriod) : "0";
  let statPages = "— págs estimadas";
  if (
    summary.estimatedPages != null &&
    Number.isFinite(Number(summary.estimatedPages)) &&
    Number(summary.estimatedPages) > 0
  ) {
    const p = Number(summary.estimatedPages);
    const s = Number.isInteger(p) ? String(p) : p.toFixed(0);
    statPages = `~${s} págs estimadas`;
  }
  return {
    ...data,
    period,
    mosaicTiles,
    booksRead,
    lastRated,
    lastRead,
    statBooksRead,
    statRatings,
    statPages,
  };
}

/**
 * Prepara dados da API `kind=rating` para o template stats-ratings-card.html.
 */
function normalizeRatingsTemplateData(data) {
  const rs = data.ratingSummary || {};
  const out = { ...data };
  out.avgRatingDisplay = formatPtDecimal(rs.avgRating);
  out.totalRatingsDisplay =
    rs.totalRatings != null ? String(rs.totalRatings) : "0";
  out.uniqueTracksRated = rs.uniqueTracks != null ? rs.uniqueTracks : 0;
  out.uniqueArtistsRated = rs.uniqueArtists != null ? rs.uniqueArtists : 0;
  out.topRatedArtists = (data.topRatedArtists || []).map((a) => ({
    ...a,
    avgRatingDisplay: formatPtDecimal(a.avgRating),
    ratingSlash10: formatRatingSlash10(a.avgRating),
    trackCountLabel:
      a.trackCount != null ? `${a.trackCount} músicas` : "—",
  }));
  out.topRatedTracks = (data.topRatedTracks || []).map((t) => ({
    ...t,
    ratingDisplay: formatPtDecimal(t.rating),
    ratingSlash10: formatRatingSlash10(t.rating),
    listenedInPeriodLabel:
      t.listenedInPeriodLabel != null ? t.listenedInPeriodLabel : "—",
  }));
  out.mosaicTiles = buildMosaicTiles(data.albumImages || []);
  return out;
}

async function renderMoviesCard(data, opts = {}) {
  const payload = normalizeMoviesTemplateData(data);
  if (payload.logoPath) {
    const exists = fs.existsSync(payload.logoPath);
    if (exists) {
      try {
        const logoBuffer = fs.readFileSync(payload.logoPath);
        payload.logoBase64 = `data:image/png;base64,${logoBuffer.toString("base64")}`;
      } catch (err) {
        console.error("[statsMoviesCard] Erro ao converter logo:", err);
        payload.logoBase64 = "";
      }
    } else {
      payload.logoBase64 = "";
    }
  } else {
    payload.logoBase64 = "";
  }

  const html = moviesTpl(payload);
  let browser = null;
  let page = null;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    const viewport = {
      width: opts.width ?? DEFAULT_CARD_VIEWPORT.width,
      height: opts.height ?? DEFAULT_CARD_VIEWPORT.height,
      deviceScaleFactor:
        opts.deviceScaleFactor ?? DEFAULT_CARD_VIEWPORT.deviceScaleFactor,
    };
    await page.setViewport(viewport);
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({
      type: "png",
      fullPage: true,
    });
    await logPngDimensions(buffer, "statsMoviesCard", viewport.deviceScaleFactor);
    await page.close();
    return buffer;
  } catch (error) {
    console.error("[statsMoviesCard] Erro durante renderização:", error);
    if (page) await page.close().catch(() => {});
    throw error;
  }
}

async function renderBooksCard(data, opts = {}) {
  const payload = normalizeBooksTemplateData(data);
  if (payload.logoPath) {
    const exists = fs.existsSync(payload.logoPath);
    if (exists) {
      try {
        const logoBuffer = fs.readFileSync(payload.logoPath);
        payload.logoBase64 = `data:image/png;base64,${logoBuffer.toString("base64")}`;
      } catch (err) {
        console.error("[statsBooksCard] Erro ao converter logo:", err);
        payload.logoBase64 = "";
      }
    } else {
      payload.logoBase64 = "";
    }
  } else {
    payload.logoBase64 = "";
  }

  const html = booksTpl(payload);
  let browser = null;
  let page = null;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    const viewport = {
      width: opts.width ?? DEFAULT_CARD_VIEWPORT.width,
      height: opts.height ?? DEFAULT_CARD_VIEWPORT.height,
      deviceScaleFactor:
        opts.deviceScaleFactor ?? DEFAULT_CARD_VIEWPORT.deviceScaleFactor,
    };
    await page.setViewport(viewport);
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({
      type: "png",
      fullPage: true,
    });
    await logPngDimensions(buffer, "statsBooksCard", viewport.deviceScaleFactor);
    await page.close();
    return buffer;
  } catch (error) {
    console.error("[statsBooksCard] Erro durante renderização:", error);
    if (page) await page.close().catch(() => {});
    throw error;
  }
}

async function renderRatingsCard(data, opts = {}) {
  const payload = normalizeRatingsTemplateData(data);
  console.log("[statsRatingsCard] Iniciando renderização");

  if (payload.logoPath) {
    const exists = fs.existsSync(payload.logoPath);
    if (exists) {
      try {
        const logoBuffer = fs.readFileSync(payload.logoPath);
        payload.logoBase64 = `data:image/png;base64,${logoBuffer.toString("base64")}`;
      } catch (err) {
        console.error("[statsRatingsCard] Erro ao converter logo:", err);
        payload.logoBase64 = "";
      }
    } else {
      payload.logoBase64 = "";
    }
  } else {
    payload.logoBase64 = "";
  }

  const html = ratingsTpl(payload);
  let browser = null;
  let page = null;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    const viewport = {
      width: opts.width ?? DEFAULT_CARD_VIEWPORT.width,
      height: opts.height ?? DEFAULT_CARD_VIEWPORT.height,
      deviceScaleFactor:
        opts.deviceScaleFactor ?? DEFAULT_CARD_VIEWPORT.deviceScaleFactor,
    };
    console.log("[statsRatingsCard] Configurando viewport:", viewport);
    await page.setViewport(viewport);
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({
      type: "png",
      fullPage: true,
    });
    await logPngDimensions(buffer, "statsRatingsCard", viewport.deviceScaleFactor);
    await page.close();
    return buffer;
  } catch (error) {
    console.error("[statsRatingsCard] Erro durante renderização:", error);
    if (page) await page.close().catch(() => {});
    throw error;
  }
}

async function renderCard(data, opts = {}) {
  console.log("[statsCard] Iniciando renderização com dados:", {
    total: data.total,
    unique: data.unique,
    time: data.time,
  });

  // Convert logo to base64 if logoPath is provided
  console.log("[statsCard/LOGO] logoPath recebido:", data.logoPath);

  if (data.logoPath) {
    console.log(
      "[statsCard/LOGO] Verificando se arquivo existe:",
      data.logoPath,
    );
    const exists = fs.existsSync(data.logoPath);
    console.log("[statsCard/LOGO] Arquivo existe?", exists);

    if (exists) {
      try {
        console.log("[statsCard/LOGO] Lendo arquivo do logo...");
        const logoBuffer = fs.readFileSync(data.logoPath);
        console.log(
          "[statsCard/LOGO] Logo lido, tamanho:",
          logoBuffer.length,
          "bytes",
        );

        const logoBase64 = logoBuffer.toString("base64");
        console.log(
          "[statsCard/LOGO] Logo convertido para base64, tamanho:",
          logoBase64.length,
          "caracteres",
        );

        data.logoBase64 = `data:image/png;base64,${logoBase64}`;
        console.log("[statsCard/LOGO] ✅ Logo base64 configurado com sucesso");
      } catch (err) {
        console.error("[statsCard/LOGO] ❌ Erro ao converter logo:", err);
        data.logoBase64 = "";
      }
    } else {
      console.warn(
        "[statsCard/LOGO] ⚠️ Arquivo de logo não encontrado:",
        data.logoPath,
      );
      data.logoBase64 = "";
    }
  } else {
    console.warn("[statsCard/LOGO] ⚠️ logoPath não foi fornecido nos dados");
    data.logoBase64 = "";
  }

  const html = tpl(data);
  console.log(
    "[statsCard] Template HTML compilado, tamanho:",
    html.length,
    "caracteres",
  );

  // Log para verificar se logoBase64 está no HTML
  if (data.logoBase64) {
    const hasLogoInHtml = html.includes('class="logo"');
    console.log(
      "[statsCard/LOGO] Tag de logo presente no HTML?",
      hasLogoInHtml,
    );
  }

  let browser = null;
  let page = null;

  try {
    console.log("[statsCard] Obtendo instância do browser...");
    browser = await getBrowser();

    console.log("[statsCard] Criando nova página...");
    page = await browser.newPage();

    const viewport = {
      width: opts.width ?? DEFAULT_CARD_VIEWPORT.width,
      height: opts.height ?? DEFAULT_CARD_VIEWPORT.height,
      deviceScaleFactor:
        opts.deviceScaleFactor ?? DEFAULT_CARD_VIEWPORT.deviceScaleFactor,
    };
    console.log("[statsCard] Configurando viewport:", viewport);
    await page.setViewport(viewport);

    console.log("[statsCard] Carregando HTML na página...");
    await page.setContent(html, { waitUntil: "networkidle0" });
    console.log("[statsCard] HTML carregado com sucesso");

    console.log("[statsCard] Capturando screenshot...");
    const buffer = await page.screenshot({
      type: "png",
      fullPage: true,
    });
    await logPngDimensions(buffer, "statsCard", viewport.deviceScaleFactor);
    console.log(
      "[statsCard] Screenshot capturado, tamanho:",
      buffer.length,
      "bytes",
    );

    await page.close();
    console.log("[statsCard] Página fechada");

    // Return buffer directly without downscaling for maximum quality
    console.log("[statsCard] Imagem final:", buffer.length, "bytes");
    return buffer;
  } catch (error) {
    console.error("[statsCard] Erro durante renderização:", error);
    if (page) await page.close().catch(() => {});
    throw error;
  }
}

module.exports = {
  renderCard,
  renderRatingsCard,
  renderMoviesCard,
  renderBooksCard,
  DEFAULT_CARD_VIEWPORT,
};
