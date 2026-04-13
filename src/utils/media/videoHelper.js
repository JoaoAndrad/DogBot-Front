const os = require("os");
const path = require("path");
const fs = require("fs").promises;
const { spawn } = require("child_process");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

function obterFfmpegPath() {
  if (ffmpegInstaller && ffmpegInstaller.path) return ffmpegInstaller.path;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return null;
}

async function salvarVideoTemporario(buffer, filenameHint) {
  if (!buffer) return null;
  const tmpDir = os.tmpdir();
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}-${
    filenameHint || "video"
  }`;
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

function executarFfmpeg(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const ffmpegPath = obterFfmpegPath();
    if (!ffmpegPath)
      return resolve({ success: false, reason: "missing-ffmpeg" });
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const to = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ success: false, reason: "timeout" });
    }, timeoutMs);
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) => {
      clearTimeout(to);
      resolve({ success: code === 0, code, stderr });
    });
  });
}

async function comprimirVideoSeNecessario(
  inputPath,
  { limitBytes = 16 * 1024 * 1024 } = {}
) {
  try {
    const st = await fs.stat(inputPath);
    if (st.size <= limitBytes) return { path: inputPath, wasCompressed: false };
    const crfAttempts = [28, 32, 36];
    for (const crf of crfAttempts) {
      const out = `${inputPath}-crf${crf}.mp4`;
      const args = [
        "-y",
        "-i",
        inputPath,
        "-vf",
        "scale='min(720,iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        String(crf),
        out,
      ];
      const res = await executarFfmpeg(args);
      if (res.success) {
        const st2 = await fs.stat(out);
        if (st2.size <= limitBytes)
          return { path: out, wasCompressed: true, original: inputPath };
        await fs.unlink(out).catch(() => {});
      }
    }
    return { path: inputPath, wasCompressed: false };
  } catch (e) {
    return { path: inputPath, wasCompressed: false };
  }
}

module.exports = {
  obterFfmpegPath,
  salvarVideoTemporario,
  comprimirVideoSeNecessario,
  executarFfmpeg,
};
