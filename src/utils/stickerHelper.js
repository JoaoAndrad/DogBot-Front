/**
 * Helper for downloading Spotify album art and sending as WhatsApp sticker
 */

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const sharp = require("sharp");
const { MessageMedia } = require("whatsapp-web.js");
const logger = require("./logger");

// Attempt to ensure the browser page has MediaUploadQpl initialized.
// Some whatsapp-web.js versions expose the Puppeteer page as `pupPage`, `page`, or `_page`.
async function ensureUploadQpl(client) {
  const candidates = [client.pupPage, client.page, client._page];
  // also try a getter if present
  if (typeof client.getPage === "function") {
    try {
      const p = await client.getPage();
      candidates.push(p);
    } catch (e) {}
  }

  for (const p of candidates) {
    if (!p || typeof p.evaluate !== "function") continue;
    try {
      const ok = await p.evaluate(() => {
        try {
          if (!window.Store) return false;

          // Ensure Store.MediaUpload includes WAWebStartMediaUploadQpl when available
          try {
            if (
              !window.Store.MediaUpload &&
              typeof window.require === "function"
            ) {
              const modA = window.require("WAWebMediaMmsV4Upload");
              const modB = window.require("WAWebStartMediaUploadQpl");
              window.Store.MediaUpload = Object.assign(
                {},
                modA || {},
                modB || {},
              );
            }
          } catch (e) {
            // ignore if modules aren't available
          }

          // Find a starter function for the QPL
          const starter =
            (window.Store.MediaUpload &&
              window.Store.MediaUpload.startMediaUploadQpl) ||
            (window.Store.MediaUploadQpl &&
              window.Store.MediaUploadQpl.startMediaUploadQpl) ||
            (window.Store.MediaUploadQpl &&
              window.Store.MediaUploadQpl.startMediaUploadQpl);
          if (!starter) return false;

          if (!window.__uploadQplInitialized) {
            try {
              window.__uploadQpl = starter({ entryPoint: "MediaUpload" });
            } catch (e) {
              try {
                window.__uploadQpl = starter({
                  entryPoint: "SyncdNetCallbacks",
                });
              } catch (e2) {
                try {
                  window.__uploadQpl = starter();
                } catch (e3) {
                  // failed to start QPL
                }
              }
            }
            window.__uploadQplInitialized = !!window.__uploadQpl;
          }

          // Patch UploadUtils.encryptAndUpload to inject uploadQpl when missing
          try {
            if (
              window.Store &&
              window.Store.UploadUtils &&
              !window.Store.UploadUtils.__patchedInjectUploadQpl
            ) {
              const orig = window.Store.UploadUtils.encryptAndUpload;
              if (typeof orig === "function") {
                window.Store.UploadUtils.encryptAndUpload = async function (
                  opts,
                ) {
                  try {
                    if (!opts) opts = {};
                    if (!opts.uploadQpl && window.__uploadQpl)
                      opts.uploadQpl = window.__uploadQpl;
                  } catch (e) {}
                  return orig.apply(this, arguments);
                };
                window.Store.UploadUtils.__patchedInjectUploadQpl = true;
              }
            }
          } catch (e) {
            // ignore
          }

          return !!window.__uploadQpl;
        } catch (e) {
          return false;
        }
      });
      if (ok) {
        logger.debug("[StickerHelper] MediaUploadQpl initialized on page");
        return true;
      }
    } catch (e) {
      logger.debug(
        "[StickerHelper] ensureUploadQpl evaluate failed: " + e.message,
      );
    }
  }
  logger.debug(
    "[StickerHelper] Could not initialize MediaUploadQpl on any known page handle",
  );
  return false;
}

// Create temp directory if it doesn't exist
const TEMP_DIR = path.join(__dirname, "../../temp/stickers");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Download image from URL to raw buffer (no resize). Use for posters so
 * sendBufferAsSticker can send dual stickers (crop + full) when aspect !== 1.
 * @param {string} imageUrl - URL of the image to download
 * @returns {Promise<Buffer|null>} Raw image buffer or null
 */
async function downloadImageToBuffer(imageUrl, opts = {}) {
  try {
    if (!imageUrl) return null;
    const response = await fetch(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          opts.userAgent ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...(opts.headers || {}),
      },
    });
    if (!response.ok) return null;
    if (typeof response.buffer === "function") {
      return await response.buffer();
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (e) {
    logger.debug("[StickerHelper] downloadImageToBuffer: " + e.message);
    return null;
  }
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
      logger.debug("[StickerHelper] No image URL provided");
      return null;
    }

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
      logger.debug("[StickerHelper] No track image available");
      return false;
    }

    // Download and convert
    const webpBuffer = await downloadAndConvertToWebp(
      track.image,
      track.trackId,
    );
    if (!webpBuffer) {
      logger.debug("[StickerHelper] Failed to create WebP buffer");
      return false;
    }

    // Create MessageMedia with base64 encoded WebP and explicit filename
    const media = new MessageMedia(
      "image/webp",
      webpBuffer.toString("base64"),
      "sticker.webp",
    );

    // Ensure MediaUploadQpl is initialized on the page (fixes encryptAndUpload failures)
    try {
      await ensureUploadQpl(client);
    } catch (e) {
      logger.debug(
        "[StickerHelper] ensureUploadQpl threw: " +
          (e && e.message ? e.message : String(e)),
      );
    }

    // Send as sticker with explicit sticker metadata. If it fails, log details and try a fallback (send as image)
    try {
      await client.sendMessage(chatId, media, {
        sendMediaAsSticker: true,
      });
      return true;
    } catch (sendErr) {
      // Log full error for debugging (stack and raw object if available)
      logger.error(
        `[StickerHelper] Error sending sticker (stack): ${sendErr && sendErr.stack ? sendErr.stack : String(sendErr)}`,
      );
      try {
        logger.debug(
          `[StickerHelper] Attempting fallback: send as regular image for ${track.trackName}`,
        );
        await client.sendMessage(chatId, media); // fallback: send as image
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
      logger.debug(`[StickerHelper] Track ${i} has no image URL`);
      continue;
    }

    const buf = await downloadAndResize(url, SIZE, SIZE);
    if (buf) {
      imgs.push(buf);
      logger.debug(`[StickerHelper] Successfully downloaded image ${i}`);
    } else {
      logger.debug(`[StickerHelper] Failed to download image ${i} from ${url}`);
    }
  }

  const n = imgs.length;
  if (n === 0) {
    logger.error("[StickerHelper] No images could be downloaded");
    return null;
  }

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
      // Create 3 parallel diagonal stripes from top-right to bottom-left
      // Lines: x + y = 341 and x + y = 683
      const masks = [];

      // Band 1 (top-right): region where x + y <= 341
      // Triangle from (0,0) to (341,0) to (0,341)
      masks.push(
        Buffer.from(
          `<svg width="${SIZE}" height="${SIZE}">
            <polygon points="0,0 341,0 0,341" fill="white"/>
          </svg>`,
        ),
      );

      // Band 2 (middle): region where 341 < x + y < 683
      // Hexagon bounded by the two parallel lines
      masks.push(
        Buffer.from(
          `<svg width="${SIZE}" height="${SIZE}">
            <polygon points="341,0 512,0 512,171 171,512 0,512 0,341" fill="white"/>
          </svg>`,
        ),
      );

      // Band 3 (bottom-left): region where x + y >= 683
      // Triangle from (512,171) to (512,512) to (171,512)
      masks.push(
        Buffer.from(
          `<svg width="${SIZE}" height="${SIZE}">
            <polygon points="512,171 512,512 171,512" fill="white"/>
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
    if (!tracks || tracks.length === 0) {
      logger.debug("[StickerHelper] No tracks provided for composite sticker");
      return false;
    }

    // Build composite webp
    const webpBuf = await createCompositeWebp(tracks.slice(0, 9));
    if (!webpBuf) {
      logger.error("[StickerHelper] Failed to create composite WebP buffer");
      return false;
    }

    const media = new MessageMedia(
      "image/webp",
      webpBuf.toString("base64"),
      "sticker.webp",
    );

    try {
      await ensureUploadQpl(client);
    } catch (e) {
      logger.debug(
        "[StickerHelper] ensureUploadQpl threw: " +
          (e && e.message ? e.message : String(e)),
      );
    }

    // Try to send as sticker
    try {
      await client.sendMessage(chatId, media, {
        sendMediaAsSticker: true,
      });
      return true;
    } catch (sendErr) {
      logger.error(
        `[StickerHelper] Error sending composite sticker (stack): ${sendErr && sendErr.stack ? sendErr.stack : String(sendErr)}`,
      );

      // Fallback: try sending as regular image
      try {
        logger.debug(
          `[StickerHelper] Attempting fallback: send as regular image`,
        );
        await client.sendMessage(chatId, media);
        return true;
      } catch (fallbackErr) {
        logger.error(
          `[StickerHelper] Fallback send failed: ${fallbackErr && fallbackErr.stack ? fallbackErr.stack : String(fallbackErr)}`,
        );
        return false;
      }
    }
  } catch (e) {
    logger.error(`[StickerHelper] sendCompositeSticker error: ${e.message}`);
    logger.error(`[StickerHelper] Stack trace: ${e.stack}`);
    return false;
  }
}

/**
 * Convert a Buffer (image) to WebP sticker and send as sticker (or fallback to image).
 * Options: { filename?, quoted?, fullOnly? }
 * - fullOnly: if true, send only the full image (contain with padding), no cropped version
 */
async function sendBufferAsSticker(client, chatId, buffer, opts = {}) {
  try {
    if (!buffer) return false;

    // Respect EXIF rotation and read metadata
    const image = sharp(buffer).rotate();
    const meta = await image.metadata().catch(() => ({}));
    const width = meta.width || 0;
    const height = meta.height || 0;
    const aspect = width && height ? width / height : 1;

    // Decide whether to send dual stickers: crop + full-fit
    // Decide whether to send dual stickers: only when aspect differs significantly from 1:1
    // Images that are square (or near-square) will send a single sticker even if larger than 512px.
    const needsDual = Math.abs(aspect - 1) > 0.05;

    // Helper to build MessageMedia from a buffer
    const buildMedia = (buf, filename) =>
      new MessageMedia(
        "image/webp",
        buf.toString("base64"),
        filename || "sticker.webp",
      );

    try {
      await ensureUploadQpl(client);
    } catch (e) {
      logger.debug(
        "[StickerHelper] ensureUploadQpl threw: " +
          (e && e.message ? e.message : String(e)),
      );
    }

    // fullOnly: only send the complete image (contain with padding), no crop
    if (opts.fullOnly) {
      const containBuf = await image
        .clone()
        .resize(512, 512, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 80 })
        .toBuffer();
      const media = buildMedia(containBuf, opts.filename || "sticker.webp");
      try {
        await client.sendMessage(chatId, media, {
          sendMediaAsSticker: true,
          ...(opts.quoted ? { quoted: opts.quoted } : {}),
        });
        return true;
      } catch (sendErr) {
        logger.error(
          `[StickerHelper] Error sending full-only sticker: ${sendErr && sendErr.stack ? sendErr.stack : String(sendErr)}`,
        );
        try {
          await client.sendMessage(chatId, media, opts.quoted ? { quoted: opts.quoted } : {});
          return true;
        } catch (fallbackErr) {
          logger.error(`[StickerHelper] Fallback failed: ${fallbackErr && fallbackErr.stack ? fallbackErr.stack : String(fallbackErr)}`);
          return false;
        }
      }
    }

    // If dual stickers requested by heuristics or by option, send both
    if (needsDual || opts.forceDual) {
      try {
        // cropped (fills square) - prefer entropy for subject
        const cropBuf = await image
          .clone()
          .resize(512, 512, { fit: "cover", position: "entropy" })
          .webp({ quality: 80 })
          .toBuffer();

        // full-fit (contains entire image with transparent padding)
        const containBuf = await image
          .clone()
          .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .webp({ quality: 80 })
          .toBuffer();

        const cropMedia = buildMedia(
          cropBuf,
          opts.filename || "sticker-crop.webp",
        );
        const containMedia = buildMedia(
          containBuf,
          opts.filename || "sticker-full.webp",
        );

        // send cropped first (quoted if provided)
        await client.sendMessage(
          chatId,
          cropMedia,
          Object.assign(
            { sendMediaAsSticker: true },
            opts.quoted ? { quoted: opts.quoted } : {},
          ),
        );

        // then send full-fit
        await client.sendMessage(
          chatId,
          containMedia,
          Object.assign(
            { sendMediaAsSticker: true },
            opts.quoted ? { quoted: opts.quoted } : {},
          ),
        );

        return true;
      } catch (sendErr) {
        logger.error(
          `[StickerHelper] Error sending dual stickers: ${sendErr && sendErr.stack ? sendErr.stack : String(sendErr)}`,
        );
        // Fallback: try single sticker crop
        try {
          const fallbackBuf = await image
            .clone()
            .resize(512, 512, { fit: "cover", position: "entropy" })
            .webp({ quality: 80 })
            .toBuffer();
          const media2 = buildMedia(
            fallbackBuf,
            opts.filename || "sticker.webp",
          );
          await client.sendMessage(
            chatId,
            media2,
            opts.quoted ? { quoted: opts.quoted } : {},
          );
          return true;
        } catch (fallbackErr) {
          logger.error(
            `[StickerHelper] Dual-fallback failed: ${fallbackErr && fallbackErr.stack ? fallbackErr.stack : String(fallbackErr)}`,
          );
          return false;
        }
      }
    }

    // Default single sticker: cover center
    const webpBuffer = await image
      .resize(512, 512, { fit: "cover", position: "center" })
      .webp({ quality: 80 })
      .toBuffer();

    const media = buildMedia(webpBuffer, opts.filename || "sticker.webp");

    try {
      const sendOpts = Object.assign(
        { sendMediaAsSticker: true },
        opts.quoted ? { quoted: opts.quoted } : {},
      );
      await client.sendMessage(chatId, media, sendOpts);
      return true;
    } catch (sendErr) {
      logger.error(
        `[StickerHelper] Error sending buffer sticker: ${sendErr && sendErr.stack ? sendErr.stack : String(sendErr)}`,
      );
      // Fallback to send as regular image
      try {
        const sendOpts = opts.quoted ? { quoted: opts.quoted } : {};
        await client.sendMessage(chatId, media, sendOpts);
        return true;
      } catch (fallbackErr) {
        logger.error(
          `[StickerHelper] Fallback send failed: ${fallbackErr && fallbackErr.stack ? fallbackErr.stack : String(fallbackErr)}`,
        );
        return false;
      }
    }
  } catch (e) {
    logger.error("[StickerHelper] sendBufferAsSticker error: " + e.message);
    return false;
  }
}

module.exports = {
  sendTrackSticker,
  downloadAndConvertToWebp,
  downloadImageToBuffer,
  sendCompositeSticker,
  downloadAndResize,
  sendBufferAsSticker,
};
