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
        `[StickerHelper] Failed to download image: ${response.status}`,
      );
      return null;
    }

    const buffer = await response.buffer();
    logger.debug(
      `[StickerHelper] Downloaded ${buffer.length} bytes from ${imageUrl}`,
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
      `[StickerHelper] Converted to WebP: ${webpBuffer.length} bytes`,
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
      `[StickerHelper] Sending sticker for ${track.trackName} to ${chatId}`,
    );

    // Download and convert
    const webpBuffer = await downloadAndConvertToWebp(
      track.image,
      track.trackId,
    );
    if (!webpBuffer) {
      logger.warn("[StickerHelper] Failed to create WebP buffer");
      return false;
    }

    // Create MessageMedia with base64 encoded WebP and explicit filename
    const media = new MessageMedia(
      "image/webp",
      webpBuffer.toString("base64"),
      "sticker.webp",
    );

    // Send as sticker with explicit sticker metadata. If it fails, log details and try a fallback (send as image)
    try {
      await client.sendMessage(chatId, media, {
        sendMediaAsSticker: true,
        stickerAuthor: "DogBot",
        stickerName: track.trackName || "Sticker",
      });
      logger.info(
        `[StickerHelper] ✅ Sticker sent successfully for ${track.trackName}`,
      );
      return true;
    } catch (sendErr) {
      // Log full error for debugging (stack and raw object if available)
      logger.error(
        `[StickerHelper] Error sending sticker (stack): ${sendErr && sendErr.stack ? sendErr.stack : String(sendErr)}`,
      );
      try {
        logger.warn(
          `[StickerHelper] Attempting fallback: send as regular image for ${track.trackName}`,
        );
        await client.sendMessage(chatId, media); // fallback: send as image
        logger.info(
          `[StickerHelper] ✅ Fallback image sent for ${track.trackName}`,
        );
        return true;
      } catch (fallbackErr) {
        logger.error(
          `[StickerHelper] Fallback send failed: ${fallbackErr && fallbackErr.stack ? fallbackErr.stack : String(fallbackErr)}`,
        );
        return false;
      }
    }
  } catch (error) {
    logger.error(`[StickerHelper] Error sending sticker: ${error.message}`);
    return false;
  }
}

/**
 * Download image and resize to specified dimensions
 */
async function downloadAndResize(imageUrl, width, height) {
  try {
    if (!imageUrl) return null;
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buf = await res.buffer();
    const resized = await sharp(buf)
      .resize(width, height, { fit: "cover", position: "center" })
      .toBuffer();
    return resized;
  } catch (e) {
    logger.error("[StickerHelper] downloadAndResize error: " + e.message);
    return null;
  }
}

/**
 * Create a composite WebP buffer from multiple track images.
 * Layout rules:
 * - 1 image: 100% (512x512)
 * - 2 images: diagonal split (two triangles)
 * - 3 images: 3 diagonal bands (equal width)
 * - 4+ images: square grid (NxM)
 */
async function createCompositeWebp(tracks) {
  if (!tracks || tracks.length === 0) return null;
  const SIZE = 512;

  // Download and resize images
  const imgs = [];
  for (let i = 0; i < tracks.length && i < 9; i++) {
    const url = tracks[i].image;
    if (!url) {
      logger.warn(`[StickerHelper] Track ${i} has no image URL`);
      continue;
    }

    const buf = await downloadAndResize(url, SIZE, SIZE);
    if (buf) {
      imgs.push(buf);
      logger.debug(`[StickerHelper] Successfully downloaded image ${i}`);
    } else {
      logger.warn(`[StickerHelper] Failed to download image ${i} from ${url}`);
    }
  }

  const n = imgs.length;
  if (n === 0) {
    logger.error("[StickerHelper] No images could be downloaded");
    return null;
  }

  logger.info(`[StickerHelper] Creating composite with ${n} images`);

  try {
    if (n === 1) {
      // Single image: full 512x512
      return await sharp(imgs[0])
        .resize(SIZE, SIZE, { fit: "cover" })
        .webp({ quality: 80 })
        .toBuffer();
    }

    if (n === 2) {
      // Two images: diagonal split (bottom-left triangle + top-right triangle)
      // Create SVG masks for the two triangles
      const mask0 = Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}">
          <polygon points="0,0 0,${SIZE} ${SIZE},${SIZE}" fill="white"/>
        </svg>`,
      );

      const mask1 = Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}">
          <polygon points="0,0 ${SIZE},0 ${SIZE},${SIZE}" fill="white"/>
        </svg>`,
      );

      // Ensure images have alpha channel before applying masks
      const [masked0, masked1] = await Promise.all([
        sharp(imgs[0])
          .resize(SIZE, SIZE, { fit: "cover" })
          .ensureAlpha()
          .composite([{ input: mask0, blend: "dest-in" }])
          .png()
          .toBuffer(),
        sharp(imgs[1])
          .resize(SIZE, SIZE, { fit: "cover" })
          .ensureAlpha()
          .composite([{ input: mask1, blend: "dest-in" }])
          .png()
          .toBuffer(),
      ]);

      // Combine both masked images on a black background
      return await sharp({
        create: {
          width: SIZE,
          height: SIZE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      })
        .composite([
          { input: masked0, blend: "over" },
          { input: masked1, blend: "over" },
        ])
        .webp({ quality: 80 })
        .toBuffer();
    }

    if (n === 3) {
      // Three images: 3 diagonal bands (equal width ~33.3% each)
      // Create 3 parallel diagonal stripes with equal perpendicular width
      const masks = [];

      // For equal width bands parallel to the main diagonal (0,512)→(512,0)
      // We need bands at 1/3 and 2/3 of the distance

      // Band 1: bottom-left corner
      masks.push(
        Buffer.from(
          `<svg width="${SIZE}" height="${SIZE}">
            <polygon points="0,${SIZE} 0,${Math.floor(
              (SIZE * 2) / 3,
            )} ${Math.floor(SIZE / 3)},${SIZE}" fill="white"/>
          </svg>`,
        ),
      );

      // Band 2: middle diagonal stripe
      masks.push(
        Buffer.from(
          `<svg width="${SIZE}" height="${SIZE}">
            <polygon points="0,${Math.floor((SIZE * 2) / 3)} 0,${Math.floor(
              SIZE / 3,
            )} ${Math.floor(SIZE / 3)},0 ${Math.floor(
              (SIZE * 2) / 3,
            )},0 ${SIZE},${Math.floor((SIZE * 2) / 3)} ${Math.floor(
              (SIZE * 2) / 3,
            )},${SIZE} ${Math.floor(SIZE / 3)},${SIZE}" fill="white"/>
          </svg>`,
        ),
      );

      // Band 3: top-right corner
      masks.push(
        Buffer.from(
          `<svg width="${SIZE}" height="${SIZE}">
            <polygon points="${Math.floor(
              (SIZE * 2) / 3,
            )},0 ${SIZE},0 ${SIZE},${Math.floor(SIZE / 3)} ${SIZE},${Math.floor(
              (SIZE * 2) / 3,
            )} ${Math.floor((SIZE * 2) / 3)},${SIZE}" fill="white"/>
          </svg>`,
        ),
      );

      // Apply masks to images with alpha channel
      const masked = await Promise.all(
        imgs.slice(0, 3).map((img, idx) =>
          sharp(img)
            .resize(SIZE, SIZE, { fit: "cover" })
            .ensureAlpha()
            .composite([{ input: masks[idx], blend: "dest-in" }])
            .png()
            .toBuffer(),
        ),
      );

      // Combine all three masked images on a black background
      return await sharp({
        create: {
          width: SIZE,
          height: SIZE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      })
        .composite([
          { input: masked[0], blend: "over" },
          { input: masked[1], blend: "over" },
          { input: masked[2], blend: "over" },
        ])
        .webp({ quality: 80 })
        .toBuffer();
    }

    // 4+ images: square grid
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = Math.floor(SIZE / cols);
    const cellH = Math.floor(SIZE / rows);

    const resized = await Promise.all(
      imgs.map((img) =>
        sharp(img).resize(cellW, cellH, { fit: "cover" }).toBuffer(),
      ),
    );

    const composites = [];
    for (let idx = 0; idx < n; idx++) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      composites.push({
        input: resized[idx],
        left: col * cellW,
        top: row * cellH,
      });
    }

    return await sharp({
      create: {
        width: SIZE,
        height: SIZE,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite(composites)
      .webp({ quality: 80 })
      .toBuffer();
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
    const media = new MessageMedia(
      "image/webp",
      webpBuf.toString("base64"),
      "sticker.webp",
    );
    await client.sendMessage(chatId, media, {
      sendMediaAsSticker: true,
      stickerAuthor: "DogBot",
      stickerName: "Composite",
    });
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
  downloadAndResize,
};
