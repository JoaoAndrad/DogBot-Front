"use strict";

const { execSync } = require("child_process");

const PHASE_W = 10;
const STATUS_W = 4;

function isBootDebug() {
  const l = String(process.env.LOG_LEVEL || "").toLowerCase();
  return (
    process.env.BOOT_DEBUG === "1" ||
    process.env.BOOT_DEBUG === "true" ||
    l === "debug"
  );
}

function isBootVerbose() {
  return (
    process.env.BOOT_VERBOSE === "1" || process.env.BOOT_VERBOSE === "true"
  );
}

function useColor() {
  return (
    process.stdout.isTTY &&
    !process.env.NO_COLOR &&
    process.env.FORCE_COLOR !== "0"
  );
}

const c = useColor()
  ? {
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    }
  : {
      dim: (s) => s,
      green: (s) => s,
      red: (s) => s,
      yellow: (s) => s,
    };

function padPhase(name) {
  const s = String(name || "").slice(0, PHASE_W);
  return s + " ".repeat(Math.max(0, PHASE_W - s.length));
}

function padMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return " ".repeat(7);
  const t = `${Math.round(ms)}ms`;
  return t.length >= 7 ? t : " ".repeat(7 - t.length) + t;
}

/**
 * @param {string} phase
 * @param {{ ok?: boolean, ms?: number, extra?: string }} opts
 */
function line(phase, opts = {}) {
  const ok = opts.ok !== false;
  const status = ok
    ? c.green("ok".padEnd(STATUS_W))
    : c.red("fail".padEnd(STATUS_W));
  const ms = padMs(opts.ms);
  const extra = opts.extra ? `  ${opts.extra}` : "";
  console.log(`[boot] ${padPhase(phase)} ${status} ${ms}${extra}`);
}

function separator(which) {
  if (which === "start") {
    console.log(c.dim("── dogbot frontend boot ──"));
  } else if (which === "complete") {
    console.log(c.dim("── boot complete ──"));
  }
}

function debug(...args) {
  if (isBootDebug()) {
    console.log(c.dim("[boot:debug]"), ...args);
  }
}

/**
 * @param {string} cmd
 * @param {{ cwd?: string, env?: Record<string, string>, label: string }} opts
 */
function execQuiet(cmd, opts) {
  const verbose = isBootVerbose();
  const t0 = Date.now();
  const env = { ...process.env, ...(opts.env || {}) };
  try {
    if (verbose) {
      execSync(cmd, {
        cwd: opts.cwd,
        env,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
    } else {
      execSync(cmd, {
        cwd: opts.cwd,
        env,
        stdio: "pipe",
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === "win32",
      });
    }
    const ms = Date.now() - t0;
    line(opts.label, { ok: true, ms });
    return { ok: true, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    let tail = "";
    if (e && typeof e.stderr === "string") tail = e.stderr;
    else if (e && Buffer.isBuffer(e.stderr)) tail = e.stderr.toString("utf8");
    else if (e && e.output) {
      const errBuf = e.output[2] || e.output[1];
      if (errBuf) tail = String(errBuf);
    }
    const lines = tail.split("\n").filter(Boolean);
    const last = lines.slice(-15).join("\n");
    line(opts.label, {
      ok: false,
      ms,
      extra: e && e.message ? String(e.message) : "error",
    });
    if (last) {
      console.log(c.yellow(last));
    }
    throw e;
  }
}

module.exports = {
  isBootDebug,
  isBootVerbose,
  line,
  separator,
  debug,
  execQuiet,
};
