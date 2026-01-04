/**
 * Helper for downloading Spotify album art and sending as WhatsApp sticker
 */

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const sharp = require("sharp");
const { MessageMedia } = require("whatsapp-web.js");
const logger = require("./logger");

// Create temp directory if it doesn't exist
const TEMP_DIR = path.join(__dirname, "../../temp/stickers");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Download image from URL, convert to WebP, and return as buffer
 * @param {string} imageUrl - URL of the image to download
 * @param {string} trackId - Track ID for caching purposes
 * @returns {Promise<Buffer>} WebP image buffer
 */
async function downloadAndConvertToWebp(imageUrl, trackId) {
  try {
    if (!imageUrl) {
      logger.warn("[StickerHelper] No image URL provided");
      return null;
    }

    logger.info(`[StickerHelper] Downloading image for track ${trackId}`);

    // Download image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      logger.error(
        `[StickerHelper] Failed to download image: ${response.status}`
      );
      return null;
    }

    const buffer = await response.buffer();
    logger.debug(
      `[StickerHelper] Downloaded ${buffer.length} bytes from ${imageUrl}`
    );

    // Convert to WebP with fixed square size (512x512 is recommended for WhatsApp stickers)
    const webpBuffer = await sharp(buffer)
      .resize(512, 512, {
        fit: "cover",
        position: "center",
      })
      .webp({ quality: 80 })
      .toBuffer();

    logger.info(
      `[StickerHelper] Converted to WebP: ${webpBuffer.length} bytes`
    );
    return webpBuffer;
  } catch (error) {
    logger.error(`[StickerHelper] Error processing image: ${error.message}`);
    return null;
  }
}

/**
 * Send track artwork as a WhatsApp sticker
 * @param {Object} client - WhatsApp Web client
 * @param {string} chatId - Chat ID to send to
 * @param {Object} track - Track object with image URL
 * @returns {Promise<boolean>} Success status
 */
async function sendTrackSticker(client, chatId, track) {
  try {
    if (!track || !track.image) {
      logger.warn("[StickerHelper] No track image available");
      return false;
    }

    logger.info(
      `[StickerHelper] Sending sticker for ${track.trackName} to ${chatId}`
    );

    // Download and convert
    const webpBuffer = await downloadAndConvertToWebp(
      track.image,
      track.trackId
    );
    if (!webpBuffer) {
      logger.warn("[StickerHelper] Failed to create WebP buffer");
      return false;
    }

    // Create MessageMedia with base64 encoded WebP
    const media = new MessageMedia("image/webp", webpBuffer.toString("base64"));

    // Send as sticker
    await client.sendMessage(chatId, media, { sendMediaAsSticker: true });

    logger.info(
      `[StickerHelper] ✅ Sticker sent successfully for ${track.trackName}`
    );
    return true;
  } catch (error) {
    logger.error(`[StickerHelper] Error sending sticker: ${error.message}`);
    return false;
  }
}

/**
 * Download image and resize to PNG 512x512 (for embedding in SVG)
 */
async function downloadAndResizePng(imageUrl, id) {
  try {
    if (!imageUrl) return null;
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buf = await res.buffer();
    const png = await sharp(buf)
      .resize(512, 512, { fit: "cover" })
      .png()
      .toBuffer();
    return png;
  } catch (e) {
    logger.error("[StickerHelper] downloadAndResizePng error: " + e.message);
    return null;
  }
}

/**
 * Create a composite WebP buffer from multiple track images.
 * Layout rules:
 * - 1 image: full cover
 * - 2 images: diagonal split (two triangles)
 * - 3 images: diagonal into three slices
 * - 4+ images: square grid (NxM)
 */
async function createCompositeWebp(tracks) {
  if (!tracks || tracks.length === 0) return null;
  const W = 512,
    H = 512;

  // download PNGs
  const imgs = [];
  for (let i = 0; i < tracks.length; i++) {
    const url = tracks[i].image;
    const buf = await downloadAndResizePng(url, tracks[i].trackId || String(i));
    if (buf) imgs.push({ buf, meta: tracks[i] });
    if (imgs.length >= 9) break; // limit to 9 images
  }

  const n = imgs.length;
  if (n === 0) return null;

  // helper to base64 encode PNG buffer
  const b64 = (b) => b.toString("base64");

  // build svg with clipPaths
  let svgParts = [];
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  );
  svgParts.push("<defs>");

  if (n === 1) {
    // single image — no clip needed
    svgParts.push("</defs>");
    svgParts.push(
      `<image href="data:image/png;base64,${b64(
        imgs[0].buf
      )}" x="0" y="0" width="${W}" height="${H}" />`
    );
  } else if (n === 2) {
    // two diagonal triangles
    const poly0 = `0,${H} 0,0 ${W},${H}`;
    const poly1 = `0,0 ${W},0 ${W},${H}`;
    svgParts.push(`<clipPath id="c0"><polygon points="${poly0}"/></clipPath>`);
    svgParts.push(`<clipPath id="c1"><polygon points="${poly1}"/></clipPath>`);
    svgParts.push("</defs>");
    svgParts.push(
      `<image clip-path="url(#c0)" href="data:image/png;base64,${b64(
        imgs[0].buf
      )}" x="0" y="0" width="${W}" height="${H}" />`
    );
    svgParts.push(
      `<image clip-path="url(#c1)" href="data:image/png;base64,${b64(
        imgs[1].buf
      )}" x="0" y="0" width="${W}" height="${H}" />`
    );
  } else if (n === 3) {
    // three diagonal slices using parallel lines approximation
    const slices = [];
    for (let i = 0; i < 4; i++) {
      const s = i / 3;
      const A = { x: 0, y: Math.round(H * (1 - s)) };
      const B = { x: Math.round(W * s), y: 0 };
      slices.push({ A, B });
    }
    // polygons between successive A/B
    for (let i = 0; i < 3; i++) {
      const A1 = slices[i].A;
      const B1 = slices[i].B;
      const A2 = slices[i + 1].A;
      const B2 = slices[i + 1].B;
      const pts = `${A1.x},${A1.y} ${B1.x},${B1.y} ${B2.x},${B2.y} ${A2.x},${A2.y}`;
      svgParts.push(
        `<clipPath id="c${i}"><polygon points="${pts}"/></clipPath>`
      );
    }
    svgParts.push("</defs>");
    for (let i = 0; i < 3; i++) {
      svgParts.push(
        `<image clip-path="url(#c${i})" href="data:image/png;base64,${b64(
          imgs[i].buf
        )}" x="0" y="0" width="${W}" height="${H}" />`
      );
    }
  } else {
    // grid layout
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    svgParts.push("</defs>");
    const cellW = Math.floor(W / cols);
    const cellH = Math.floor(H / rows);
    for (let idx = 0; idx < n; idx++) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = col * cellW;
      const y = row * cellH;
      // place image scaled to cover cell
      svgParts.push(
        `<image href="data:image/png;base64,${b64(
          imgs[idx].buf
        )}" x="${x}" y="${y}" width="${cellW}" height="${cellH}" preserveAspectRatio="xMidYMid slice" />`
      );
    }
  }

  svgParts.push("</svg>");
  const svg = svgParts.join("");

  try {
    const out = await sharp(Buffer.from(svg))
      .resize(W, H)
      .webp({ quality: 80 })
      .toBuffer();
    return out;
  } catch (e) {
    logger.error("[StickerHelper] createCompositeWebp error: " + e.message);
    return null;
  }
}

async function sendCompositeSticker(client, chatId, tracks) {
  try {
    if (!tracks || tracks.length === 0) return false;
    // Build composite webp
    const webpBuf = await createCompositeWebp(tracks.slice(0, 9));
    if (!webpBuf) return false;
    const media = new MessageMedia("image/webp", webpBuf.toString("base64"));
    await client.sendMessage(chatId, media, { sendMediaAsSticker: true });
    return true;
  } catch (e) {
    logger.error("[StickerHelper] sendCompositeSticker error: " + e.message);
    return false;
  }
}

module.exports = {
  sendTrackSticker,
  downloadAndConvertToWebp,
  sendCompositeSticker,
  downloadAndResizePng,
};
