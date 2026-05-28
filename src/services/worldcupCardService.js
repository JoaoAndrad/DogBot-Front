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

// Logo embutido como base64 (evita dependência de arquivo em runtime)
const logoPath = path.join(__dirname, "..", "..", "templates", "logo.png");
const logoDataUri = "data:image/png;base64," + fs.readFileSync(logoPath).toString("base64");

// Handlebars helpers
Handlebars.registerHelper("ifCond", (a, op, b, opts) => {
  const result = op === "===" ? a === b : op === ">" ? a > b : op === ">=" ? a >= b : false;
  return result ? opts.fn(this) : opts.inverse(this);
});

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

/**
 * Normaliza um grupo de standings da API para o formato do template.
 * standings: [{ team, group_name, played, won, drawn, lost, gf, ga, gd, points, position }]
 */
function buildGroupData(groupName, standings) {
  const teams = standings.map((s, i) => {
    const { pt, flag } = localize(s.team);
    const { gdDisplay, gdClass } = formatGd(s.gd);
    return {
      position: s.position || i + 1,
      flag,
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

/**
 * Renderiza card(s) de classificação e retorna PNG Buffer.
 * @param {Array} groupsData - [{ group_name, standings[] }]
 */
async function renderStandingsCard(groupsData) {
  const groups = groupsData.map((g) => buildGroupData(
    g.group_name.replace("GROUP_", "Grupo ").replace("Group ", "Grupo "),
    g.standings,
  ));

  const html = tpl({ groups, logoDataUri });

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 560, height: 800, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({ type: "png", fullPage: true });
    return buffer;
  } finally {
    await page.close();
  }
}

module.exports = { renderStandingsCard };
