import { createRequire } from "module";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const { Client, Poll } = require("whatsapp-web.js");
const { initSessionOptions } = require("../src/bot/session");
const __filename = fileURLToPath(import.meta.url);
const __dirname = require("path").dirname(__filename);

// Hardcoded chat id as requested
const chatId = "558182132346@c.us";

// Reuse the bot's LocalAuth session so this script uses the same authenticated profile
const auth = initSessionOptions();
const fs = require("fs");

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (e) {}
  }
  return null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.warn(
    "Warning: Chrome/Chromium executable not found automatically. Set CHROME_PATH to your browser executable to avoid Puppeteer launch errors."
  );
}

const path = require("path");
const fsp = require("fs").promises;
const http = require("http");

async function detectExistingBrowserWs() {
  try {
    // dataPath is frontend/.wwebjs_auth
    const dataPath = path.join(__dirname, "..", ".wwebjs_auth");
    const sessionsRoot = path.join(dataPath, "session");
    console.log("Searching for DevToolsActivePort files under", sessionsRoot);
    const dirs = await fsp.readdir(sessionsRoot).catch(() => []);
    for (const d of dirs) {
      const sessionDir = path.join(sessionsRoot, d);
      const devtoolsFile = path.join(sessionDir, "DevToolsActivePort");
      try {
        const raw = await fsp.readFile(devtoolsFile, "utf8");
        const parts = raw.trim().split("\n");
        const port = parts && parts[0] ? parts[0].trim() : null;
        const host = "127.0.0.1";
        if (!port) continue;
        const url = `http://${host}:${port}/json/version`;
        console.log(
          "Found DevToolsActivePort at",
          devtoolsFile,
          "port",
          port,
          "-> fetching",
          url
        );
        const res = await fetch(url);
        const json = await res.json();
        console.log(
          "DevTools /json/version result keys:",
          Object.keys(json || {})
        );
        if (json && json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
      } catch (e) {
        // try next session folder
        console.log(
          "No DevToolsActivePort at",
          devtoolsFile,
          ":",
          e && e.message
        );
        continue;
      }
    }
    return null;
  } catch (e) {
    console.log(
      "No existing DevTools websocket found (error):",
      e && e.message
    );
    return null;
  }
}

async function createClient() {
  const ws = await detectExistingBrowserWs();
  if (ws) {
    console.log("Connecting to existing browser via", ws);
    return new Client({
      authStrategy: auth,
      puppeteer: { browserWSEndpoint: ws },
    });
  }

  console.log(
    "No existing browser WS endpoint detected. To use the running browser, start the bot (which opens the browser) and re-run this script."
  );
  console.log(
    "Alternatively set CHROME_PATH to your browser executable so the script can launch one."
  );
  return null;
}

const client = await createClient();
if (!client) process.exit(1);

client.on("ready", async () => {
  console.log("Client ready — enviando poll para", chatId);
  const preText = `Enviando teste de poll para ${chatId}`;
  try {
    const preResult = await client.sendMessage(chatId, preText);
    console.log(
      "Mensagem pré-poll enviada:",
      preResult && preResult.id ? { id: preResult.id._serialized } : preResult
    );
  } catch (e) {
    console.log("Erro ao enviar mensagem pré-poll:", (e && e.message) || e);
  }

  const poll = new Poll("Teste real de enquete", ["Opção 1", "Opção 2"], {
    allowMultipleAnswers: false,
  });

  try {
    const result = await client.sendMessage(chatId, poll);
    console.log(
      "Poll enviada. sendMessage result:",
      result && result.id ? { id: result.id._serialized } : result
    );

    // wait a bit and fetch recent messages from chat to confirm
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const chat = await client.getChatById(chatId);
      console.log("Chat found:", {
        id: chat.id._serialized,
        isGroup: chat.isGroup,
        name: chat.name || chat.formattedTitle,
      });
      const msgs = await chat.fetchMessages({ limit: 5 });
      console.log("Últimas mensagens no chat:");
      msgs.forEach((m) =>
        console.log("-", m.id._serialized, m.type, m.body || "(no body)")
      );
    } catch (e) {
      console.log("Erro ao buscar chat/mensagens:", (e && e.message) || e);
    }
  } catch (err) {
    console.log("Erro ao enviar poll:", err);
  }

  // encerra cliente após envio
  try {
    await client.destroy();
  } catch (e) {}
  process.exit(0);
});

client.on("auth_failure", (msg) => {
  console.log("Falha de autenticação:", msg);
  process.exit(1);
});

client.on("disconnected", (reason) => {
  console.log("Client disconnected:", reason);
});

client.initialize();
