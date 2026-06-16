"use strict";

const logger = require("../utils/logger");

const GLOBO_AUTH_API = "https://login.globo.com/api/authentication";
const LOGIN_PAGE_URL = "https://login.globo.com/login/4728";
const NAVIGATE_TIMEOUT = 30000;
const COOKIE_WAIT_TIMEOUT = 12000;

/**
 * Abre um browser Puppeteer, carrega a página de login da Globo para obter os
 * cookies de sessão, depois chama a API de autenticação DENTRO do contexto do
 * browser via fetch (com Origin/Referer/cookies nativos). Com isso os cookies
 * Set-Cookie (incluindo glb_uid_jwt) ficam no browser, extraímos via CDP e
 * retornamos como string para o backend usar no Cartola FC.
 */
async function loginGloboWithPuppeteer(email, password) {
  let browser;
  try {
    const puppeteer = require("puppeteer");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,800",
      ],
      timeout: NAVIGATE_TIMEOUT,
    });

    const page = await browser.newPage();

    // Stealth: oculta navigator.webdriver e mimetiza Chrome real
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // Chrome runtime stub
      if (!window.chrome) {
        window.chrome = { runtime: {} };
      }
      // Plugins vazios são suspeitos — adiciona um stub
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["pt-BR", "pt", "en-US", "en"],
      });
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    await page.setViewport({ width: 1280, height: 800 });

    // 1. Carrega a página de login para obter cookies de sessão (CSRF etc.)
    await page.goto(LOGIN_PAGE_URL, {
      waitUntil: "networkidle2",
      timeout: NAVIGATE_TIMEOUT,
    });

    // 2. Chama a API de autenticação a partir do contexto do browser
    //    Isso garante: Origin correto, cookies de sessão enviados, Set-Cookie honorados
    const apiResult = await page.evaluate(
      async (url, emailArg, passwordArg) => {
        try {
          const res = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              payload: { email: emailArg, password: passwordArg, serviceId: 4728 },
            }),
          });
          const text = await res.text();
          return { status: res.status, text };
        } catch (e) {
          return { status: 0, text: "", error: e.message };
        }
      },
      GLOBO_AUTH_API,
      email,
      password,
    );

    logger.info(`[cartolaGloboAuth] API status=${apiResult.status} text=${apiResult.text.slice(0, 120)}`);

    if (apiResult.status === 406 || apiResult.text === "captchaBlank") {
      throw Object.assign(new Error("captcha_required"), { status: 406 });
    }
    if (apiResult.status === 401 || apiResult.status === 403) {
      throw Object.assign(new Error("auth_failed"), { status: 401 });
    }
    if (apiResult.status === 0 || !apiResult.text) {
      throw new Error("fetch_failed_in_browser: " + (apiResult.error || "unknown"));
    }
    if (apiResult.status < 200 || apiResult.status >= 300) {
      throw Object.assign(new Error("auth_failed"), { status: apiResult.status });
    }

    let data = {};
    try { data = JSON.parse(apiResult.text); } catch (_) {}

    // 3. Aguarda cookies de autenticação aparecerem no browser
    await waitForCookies(page, ["glb_uid_jwt", "GLBID"], COOKIE_WAIT_TIMEOUT);

    // 4. Extrai TODOS os cookies do browser via CDP (todos os domínios Globo)
    const cdp = await page.createCDPSession();
    const { cookies: allCookies } = await cdp.send("Network.getAllCookies");

    const globoCookies = allCookies.filter(
      (c) => c.domain && c.domain.endsWith("globo.com"),
    );

    const cookieMap = new Map();
    for (const c of globoCookies) {
      cookieMap.set(c.name, c.value);
    }

    // glbId pode vir do JSON da API ou do cookie GLBID
    const glbId =
      data?.glbId ||
      data?.userInfo?.glbId ||
      cookieMap.get("GLBID") ||
      null;

    if (glbId && !cookieMap.has("GLBID")) {
      cookieMap.set("GLBID", glbId);
    }

    const cookieHeader = [...cookieMap.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    const names = [...cookieMap.keys()];
    logger.info(`[cartolaGloboAuth] ok — cookies: [${names.join(", ")}]`);

    if (!glbId && !cookieMap.has("glb_uid_jwt")) {
      logger.warn("[cartolaGloboAuth] sem GLBID nem glb_uid_jwt após login");
    }

    return { glbId, cookies: cookieHeader };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

async function waitForCookies(page, names, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const cookies = await page.cookies();
    if (names.some((n) => cookies.some((c) => c.name === n))) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

module.exports = { loginGloboWithPuppeteer };
