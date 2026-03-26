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
const tplSrc = fs.readFileSync(templatePath, "utf8");
const tpl = Handlebars.compile(tplSrc);
const ratingsTplSrc = fs.readFileSync(ratingsTemplatePath, "utf8");
const ratingsTpl = Handlebars.compile(ratingsTplSrc);

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
  return out;
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
  DEFAULT_CARD_VIEWPORT,
};
