const fs = require("fs");
const path = require("path");

let loaded = false;

/**
 * Carrega frontend/.env sem depender do pacote `dotenv` (evita MODULE_NOT_FOUND em deploys).
 * Só define variáveis que ainda não existem em process.env.
 */
function loadEnv() {
  if (loaded) return;
  loaded = true;
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    let s = line.trim();
    if (!s || s.startsWith("#")) continue;
    if (s.startsWith("export ")) s = s.slice(7).trim();
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = s.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

module.exports = { loadEnv };
