const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

async function saveQr(qr) {
  try {
    // Garantir que o QR seja salvo em frontend/temp, independente do CWD
    const dir = path.join(__dirname, "..", "..", "temp");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "qr.png");
    await qrcode.toFile(file, qr);
    console.log("QR salvo em " + file);
    return file;
  } catch (err) {
    console.log("Erro ao salvar QR:", err);
    throw err;
  }
}

module.exports = { saveQr };
