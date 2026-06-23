"use strict";

const TEAM_LOCALE = {
  "Algeria":        { pt: "Argélia",              flag: "🇩🇿" },
  "Argentina":      { pt: "Argentina",             flag: "🇦🇷" },
  "Australia":      { pt: "Austrália",             flag: "🇦🇺" },
  "Austria":        { pt: "Áustria",               flag: "🇦🇹" },
  "Belgium":        { pt: "Bélgica",               flag: "🇧🇪" },
  "Bosnia-H.":      { pt: "Bósnia e Herz.",        flag: "🇧🇦" },
  "Brazil":         { pt: "Brasil",                flag: "🇧🇷" },
  "Canada":         { pt: "Canadá",                flag: "🇨🇦" },
  "Cape Verde":           { pt: "Cabo Verde",            flag: "🇨🇻" },
  "Cape Verde Islands":   { pt: "Cabo Verde",            flag: "🇨🇻" },
  "Colombia":       { pt: "Colômbia",              flag: "🇨🇴" },
  "Congo DR":       { pt: "RD Congo",              flag: "🇨🇩" },
  "Croatia":        { pt: "Croácia",               flag: "🇭🇷" },
  "Curaçao":        { pt: "Curaçao",               flag: "🇨🇼" },
  "Czechia":        { pt: "Rep. Tcheca",           flag: "🇨🇿" },
  "Ecuador":        { pt: "Equador",               flag: "🇪🇨" },
  "Egypt":          { pt: "Egito",                 flag: "🇪🇬" },
  "England":        { pt: "Inglaterra",            flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  "France":         { pt: "França",                flag: "🇫🇷" },
  "Germany":        { pt: "Alemanha",              flag: "🇩🇪" },
  "Ghana":          { pt: "Gana",                  flag: "🇬🇭" },
  "Haiti":          { pt: "Haiti",                 flag: "🇭🇹" },
  "Iran":           { pt: "Irã",                   flag: "🇮🇷" },
  "Iraq":           { pt: "Iraque",                flag: "🇮🇶" },
  "Ivory Coast":        { pt: "Costa do Marfim",       flag: "🇨🇮" },
  "Côte d'Ivoire":      { pt: "Costa do Marfim",       flag: "🇨🇮" },
  "Japan":          { pt: "Japão",                 flag: "🇯🇵" },
  "Jordan":         { pt: "Jordânia",              flag: "🇯🇴" },
  "Korea Republic": { pt: "Coreia do Sul",         flag: "🇰🇷" },
  "South Korea":    { pt: "Coreia do Sul",         flag: "🇰🇷" },
  "Mexico":         { pt: "México",                flag: "🇲🇽" },
  "Morocco":        { pt: "Marrocos",              flag: "🇲🇦" },
  "Netherlands":    { pt: "Holanda",               flag: "🇳🇱" },
  "New Zealand":    { pt: "Nova Zelândia",         flag: "🇳🇿" },
  "Norway":         { pt: "Noruega",               flag: "🇳🇴" },
  "Panama":         { pt: "Panamá",                flag: "🇵🇦" },
  "Paraguay":       { pt: "Paraguai",              flag: "🇵🇾" },
  "Portugal":       { pt: "Portugal",              flag: "🇵🇹" },
  "Qatar":          { pt: "Catar",                 flag: "🇶🇦" },
  "Saudi Arabia":   { pt: "Arábia Saudita",        flag: "🇸🇦" },
  "Scotland":       { pt: "Escócia",               flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  "Senegal":        { pt: "Senegal",               flag: "🇸🇳" },
  "South Africa":   { pt: "África do Sul",         flag: "🇿🇦" },
  "Spain":          { pt: "Espanha",               flag: "🇪🇸" },
  "Sweden":         { pt: "Suécia",                flag: "🇸🇪" },
  "Switzerland":    { pt: "Suíça",                 flag: "🇨🇭" },
  "TBD":            { pt: "A definir",             flag: "🏳️" },
  "Tunisia":        { pt: "Tunísia",               flag: "🇹🇳" },
  "Turkey":         { pt: "Turquia",               flag: "🇹🇷" },
  "USA":            { pt: "EUA",                   flag: "🇺🇸" },
  "United States":  { pt: "EUA",                   flag: "🇺🇸" },
  "Uruguay":        { pt: "Uruguai",               flag: "🇺🇾" },
  "Uzbekistan":     { pt: "Uzbequistão",           flag: "🇺🇿" },
};

const PT_REVERSE = {};
for (const [en, v] of Object.entries(TEAM_LOCALE)) {
  PT_REVERSE[v.pt] = { en, flag: v.flag };
}

function localize(name) {
  if (!name) return { pt: "A definir", flag: "🏳️" };
  if (PT_REVERSE[name]) return { pt: name, flag: PT_REVERSE[name].flag };
  if (TEAM_LOCALE[name]) return TEAM_LOCALE[name];
  return { pt: name, flag: "" };
}

function toPt(name) { return localize(name).pt; }

/** "🇧🇷 Brasil" */
function withFlag(name) {
  const { pt, flag } = localize(name);
  return flag ? `${flag} ${pt}` : pt;
}

/** "🇨🇭 Suíça x 🇨🇦 Canadá" */
function matchup(home, away) {
  return `${withFlag(home)} x ${withFlag(away)}`;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/** Retorna os 5 times cujo nome (PT-BR ou inglês) mais se aproxima da query. */
function searchTeams(query, limit = 5) {
  const q = query.trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!q) return [];

  const maxDist = Math.max(1, Math.floor(q.length / 4));

  const seen = new Set();
  const scored = Object.entries(TEAM_LOCALE)
    .filter(([, v]) => v.pt !== "A definir")
    .map(([en, v]) => {
      const ptName = v.pt.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const enName = en.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      let score = 0;
      for (const name of [ptName, enName]) {
        let s = 0;
        if (name === q) s = 100;
        else if (name.startsWith(q)) s = 80;
        else if (name.includes(q)) s = 60;
        else if (q.length >= 3) {
          const words = name.split(" ");
          if (words.some((w) => w.startsWith(q))) s = 40;
          else {
            const qSig = q.split(" ").filter((qw) => qw.length >= 3);
            if (qSig.length >= 2 && qSig.every((qw) => name.includes(qw))) s = 20;
          }
        }
        if (s === 0 && q.length >= 4) {
          const dist = levenshtein(q, name);
          if (dist <= maxDist) s = Math.max(5, 30 - dist * 10);
          else {
            // tenta contra cada palavra do nome composto
            for (const w of name.split(" ")) {
              if (w.length < 3) continue;
              const wd = levenshtein(q, w);
              if (wd <= maxDist) { s = Math.max(5, 20 - wd * 8); break; }
            }
          }
        }
        if (s > score) score = s;
      }
      return { ...v, score };
    })
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((v) => {
      if (seen.has(v.pt)) return false;
      seen.add(v.pt);
      return true;
    })
    .slice(0, limit);

  return scored;
}

module.exports = { localize, toPt, withFlag, matchup, searchTeams };
