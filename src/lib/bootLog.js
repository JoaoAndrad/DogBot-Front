"use strict";

const { execSync } = require("child_process");

const PHASE_W = 12;
const CONTENT_W = 44; // extra + ms stay within this width

let _startMs = 0;

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
      dim:   (s) => `\x1b[2m${s}\x1b[0m`,
      bold:  (s) => `\x1b[1m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      red:   (s) => `\x1b[31m${s}\x1b[0m`,
      yellow:(s) => `\x1b[33m${s}\x1b[0m`,
    }
  : {
      dim:   (s) => s,
      bold:  (s) => s,
      green: (s) => s,
      red:   (s) => s,
      yellow:(s) => s,
    };

function _nowTime() {
  return new Date().toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * @param {string} phase
 * @param {{ ok?: boolean, ms?: number, extra?: string }} opts
 */
function line(phase, opts = {}) {
  const ok = opts.ok !== false;
  const raw = String(phase || "");
  const phaseStr = (raw.charAt(0).toUpperCase() + raw.slice(1)).slice(0, PHASE_W).padEnd(PHASE_W);
  const label = ok ? phaseStr : c.red(phaseStr);
  const extra = opts.extra ? String(opts.extra) : "";

  if (opts.ms != null && Number.isFinite(opts.ms)) {
    const msStr = `${Math.round(opts.ms)}ms`;
    const gap = Math.max(2, CONTENT_W - extra.length - msStr.length);
    console.log(`  ${label}  ${extra}${" ".repeat(gap)}${c.dim(msStr)}`);
  } else {
    console.log(`  ${label}  ${extra}`);
  }
}

function separator(which) {
  if (which === "start") {
    _startMs = Date.now();
    console.log(`\n${c.bold("dogbot")}  iniciando  ${_nowTime()}\n`);
  } else if (which === "complete") {
    const secs = ((Date.now() - _startMs) / 1000).toFixed(1);
    console.log(`\n  Operacional em ${secs}s\n`);
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
