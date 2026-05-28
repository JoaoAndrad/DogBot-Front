"use strict";

const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const { localize } = require("../utils/teamLocale");

// ─── Template ────────────────────────────────────────────────────────────────

const templatePath = path.join(__dirname, "..", "..", "templates", "worldcup-standings.hbs");
const tplSrc = fs.readFileSync(templatePath, "utf8");
const tpl = Handlebars.compile(tplSrc);

const logoPath = path.join(__dirname, "..", "..", "templates", "logo.png");
const logoDataUri = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");

// ─── Twemoji: converte emoji de bandeira → URL de imagem ─────────────────────
// Flag emoji = dois Regional Indicator characters (ex: 🇧🇷 = U+1F1E7 U+1F1F7)

function flagEmojiToTwemojiUrl(emoji) {
  if (!emoji || emoji === "🏳️") return null;
  try {
    const codepoints = [...emoji]
      .map((c) => c.codePointAt(0).toString(16))
      .join("-");
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codepoints}.png`;
  } catch (e) {
    return null;
  }
}

// ─── Browser (reusa instância) ────────────────────────────────────────────────

let _browser = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  return _browser;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function formatGd(gd) {
  if (gd == null) return { gdDisplay: "0", gdClass: "sg-zero" };
  if (gd > 0) return { gdDisplay: `+${gd}`, gdClass: "sg-pos" };
  if (gd < 0) return { gdDisplay: String(gd), gdClass: "sg-neg" };
  return { gdDisplay: "0", gdClass: "sg-zero" };
}

function buildGroupData(groupName, standings) {
  const teams = standings.map((s, i) => {
    const { pt, flag } = localize(s.team);
    const { gdDisplay, gdClass } = formatGd(s.gd);
    const flagUrl = flagEmojiToTwemojiUrl(flag);
    return {
      position: s.position || i + 1,
      flag,
      flagUrl,       // URL da imagem Twemoji (pode ser null se não resolver)
      name: pt,
      pts: s.points ?? 0,
      played: s.played ?? 0,
      gdDisplay,
      gdClass,
      isLeader: (s.position || i + 1) === 1,
      isQualify: (s.position || i + 1) === 2,
    };
  });
  return { groupName, teams };
}

// ─── Render ───────────────────────────────────────────────────────────────────

async function renderStandingsCard(groupsData) {
  const groups = groupsData.map((g) => buildGroupData(
    g.group_name.replace("GROUP_", "Grupo ").replace("Group ", "Grupo "),
    g.standings,
  ));

  const html = tpl({ groups, logoDataUri });

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Viewport largo o suficiente, altura provisória
    await page.setViewport({ width: 560, height: 800, deviceScaleFactor: 2 });
    // networkidle0 garante que as imagens Twemoji (CDN) foram carregadas
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Mede a altura real do conteúdo e ajusta o viewport
    const contentHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ width: 560, height: contentHeight, deviceScaleFactor: 2 });

    const buffer = await page.screenshot({ type: "png", fullPage: false });
    return buffer;
  } finally {
    await page.close();
  }
}

module.exports = { renderStandingsCard };
