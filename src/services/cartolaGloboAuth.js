"use strict";

const logger = require("../utils/logger");

const LOGIN_URL = "https://login.globo.com/login/4728";
const NAVIGATE_TIMEOUT = 30000;
const COOKIE_WAIT_TIMEOUT = 15000;

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
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(LOGIN_URL, {
      waitUntil: "networkidle2",
      timeout: NAVIGATE_TIMEOUT,
    });

    // Email field — Globo uses name="email" or id="login"
    const EMAIL_SELECTORS = [
      'input[name="email"]',
      'input[type="email"]',
      'input#login',
      'input[placeholder*="mail" i]',
    ];
    const emailSel = await findFirstSelector(page, EMAIL_SELECTORS, 10000);
    if (!emailSel) throw new Error("email_field_not_found");
    await page.type(emailSel, email, { delay: 40 });

    // Globo may use a two-step flow (email → continue → password on next screen)
    const passwordExists = await page.$(
      'input[type="password"], input[name="password"]',
    );
    if (!passwordExists) {
      // Submit email step
      await Promise.all([
        waitForNavOrSelector(page, 'input[type="password"]', 12000),
        page.keyboard.press("Enter"),
      ]);
      await page.waitForSelector(
        'input[type="password"], input[name="password"]',
        { timeout: 8000 },
      );
    }

    // Password field
    const PASSWORD_SELECTORS = [
      'input[type="password"]',
      'input[name="password"]',
      'input#password',
    ];
    const pwSel = await findFirstSelector(page, PASSWORD_SELECTORS, 5000);
    if (!pwSel) throw new Error("password_field_not_found");
    await page.type(pwSel, password, { delay: 40 });

    // Submit form and wait for redirect
    await Promise.all([
      page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 20000,
      }).catch(() => {}),
      page.keyboard.press("Enter"),
    ]);

    // Check if we're still on the login page (means credentials were rejected or captcha)
    const currentUrl = page.url();
    if (currentUrl.includes("login.globo.com")) {
      const isCaptcha = await page
        .$('[class*="captcha"], iframe[title*="captcha" i], #hcaptcha, .h-captcha')
        .then((el) => !!el)
        .catch(() => false);
      if (isCaptcha) {
        throw Object.assign(new Error("captcha_required"), { status: 406 });
      }
      const errorMsg = await page
        .$eval(
          '[class*="error" i], [class*="alerta" i], [class*="mensagem" i], [class*="invalid" i]',
          (el) => el.textContent.trim(),
        )
        .catch(() => null);
      throw Object.assign(
        new Error("auth_failed"),
        { status: 401, detail: errorMsg || "still_on_login_page" },
      );
    }

    // Wait for key Globo cookies to appear
    await waitForCookies(page, ["glb_uid_jwt", "GLBID"], COOKIE_WAIT_TIMEOUT);

    // Use CDP to capture ALL cookies from the browser (all domains)
    const cdp = await page.createCDPSession();
    const { cookies: allCookies } = await cdp.send("Network.getAllCookies");

    const globoCookies = allCookies.filter((c) =>
      c.domain && (c.domain.endsWith("globo.com") || c.domain.endsWith("globoid.globo.com")),
    );

    const cookieMap = new Map();
    for (const c of globoCookies) {
      cookieMap.set(c.name, c.value);
    }

    const glbId = cookieMap.get("GLBID") || null;
    const cookieHeader = [...cookieMap.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    const names = [...cookieMap.keys()];
    logger.info(`[cartolaGloboAuth] login ok — cookies: [${names.join(", ")}]`);

    if (!glbId && !cookieMap.has("glb_uid_jwt")) {
      logger.warn("[cartolaGloboAuth] login concluído mas sem GLBID nem glb_uid_jwt");
    }

    return { glbId, cookies: cookieHeader };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
  }
}

async function findFirstSelector(page, selectors, timeout) {
  try {
    await page.waitForSelector(selectors.join(", "), { timeout });
  } catch (_) {
    return null;
  }
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return sel;
  }
  return null;
}

async function waitForNavOrSelector(page, selector, timeout) {
  return Promise.race([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout }),
    page.waitForSelector(selector, { timeout }),
  ]).catch(() => {});
}

async function waitForCookies(page, names, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const cookies = await page.cookies();
    const found = names.filter((n) => cookies.some((c) => c.name === n));
    if (found.length > 0) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
}

module.exports = { loginGloboWithPuppeteer };
