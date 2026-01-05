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
  "stats-card.html"
);
const tplSrc = fs.readFileSync(templatePath, "utf8");
const tpl = Handlebars.compile(tplSrc);

// Register helper to display 1-based index
Handlebars.registerHelper("indexPlusOne", function (index) {
  return (parseInt(index, 10) || 0) + 1;
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

  const html = tpl(data);
  console.log(
    "[statsCard] Template HTML compilado, tamanho:",
    html.length,
    "caracteres"
  );

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
      "bytes"
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
