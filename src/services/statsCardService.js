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
const tplSrc = fs.readFileSync(templatePath, "utf8");
const tpl = Handlebars.compile(tplSrc);

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
      width: opts.width || 1600,
      height: opts.height || 100,
      deviceScaleFactor: 2,
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

module.exports = { renderCard };
