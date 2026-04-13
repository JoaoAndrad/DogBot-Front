const fs = require("fs");

async function tryDownloadMedia(message) {
  if (!message) return null;
  if (typeof message.downloadMedia === "function") {
    try {
      const media = await message.downloadMedia().catch(() => null);
      if (!media) return null;

      // media may be:
      // - a data URI string
      // - a base64 string
      // - an object { data: string }
      // - an object { buffer: Buffer | Uint8Array | ArrayBuffer }
      // Normalize to Buffer and return metadata.
      let buffer = null;
      let base64 = null;

      if (typeof media === "string") {
        const s = media;
        base64 = s.includes("base64,") ? s.split("base64,").pop() : s;
        try {
          buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
        } catch (err) {
          console.log(
            "[mediaHelper] failed to decode base64 string from downloadMedia:",
            err && err.message ? err.message : err
          );
          buffer = null;
        }
      } else if (media.data && typeof media.data === "string") {
        base64 = media.data.includes("base64,")
          ? media.data.split("base64,").pop()
          : media.data;
        try {
          buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
        } catch (err) {
          console.log(
            "[mediaHelper] failed to decode media.data base64:",
            err && err.message ? err.message : err
          );
          buffer = null;
        }
      } else if (media.buffer) {
        // Support Buffer, Uint8Array, ArrayBuffer
        try {
          if (Buffer.isBuffer(media.buffer)) {
            buffer = media.buffer;
          } else if (media.buffer instanceof ArrayBuffer) {
            buffer = Buffer.from(new Uint8Array(media.buffer));
          } else if (ArrayBuffer.isView(media.buffer)) {
            buffer = Buffer.from(media.buffer);
          } else {
            // attempt generic conversion
            buffer = Buffer.from(media.buffer);
          }
        } catch (err) {
          console.log(
            "[mediaHelper] failed to normalize media.buffer:",
            err && err.message ? err.message : err
          );
          buffer = null;
        }
      }

      if (buffer && buffer.length > 0) {
        return {
          buffer,
          base64: base64 || null,
          mimetype: media.mimetype || media.mimeType || null,
          filename: media.filename || media.fileName || null,
          filesize: buffer.length,
          origin: "downloadMedia",
        };
      }
      return null;
    } catch (e) {
      console.error(
        "[mediaHelper] tryDownloadMedia unexpected error:",
        e && e.stack ? e.stack : e
      );
      return null;
    }
  }
  return null;
}

function fromMessageData(message) {
  if (!message) return null;
  if (message.data && Buffer.isBuffer(message.data)) {
    return {
      buffer: message.data,
      base64: null,
      mimetype: message.mimetype || null,
      filename: message.fileName || message.filename || null,
      filesize: message.data.length,
      origin: "message.data",
    };
  }
  if (message._data && typeof message._data.body === "string") {
    const body = message._data.body;
    try {
      const base64 = body.includes("base64,")
        ? body.split("base64,").pop()
        : body;
      const sanitized = base64.replace(/\s+/g, "");
      if (sanitized.length > 32) {
        try {
          const buffer = Buffer.from(sanitized, "base64");
          return {
            buffer,
            base64: sanitized,
            mimetype:
              message._data && message._data.mimetype
                ? message._data.mimetype
                : message.mimetype || null,
            filename:
              (message._data &&
                (message._data.fileName || message._data.filename)) ||
              null,
            filesize: buffer.length,
            origin: "message._data.body",
          };
        } catch (err) {
          console.log(
            "[mediaHelper] failed to decode message._data.body base64:",
            err && err.message ? err.message : err
          );
          return null;
        }
      }
    } catch (e) {
      console.log(
        "[mediaHelper] error parsing message._data.body:",
        e && e.message ? e.message : e
      );
      return null;
    }
  }
  return null;
}

async function obterMidiaDaMensagem(message) {
  try {
    // Try downloadMedia first
    const fromDownload = await tryDownloadMedia(message);
    if (fromDownload) return fromDownload;

    // Try direct fields
    const fromData = fromMessageData(message);
    if (fromData) return fromData;

    // No media available
    return null;
  } catch (e) {
    console.error(
      "[mediaHelper] obterMidiaDaMensagem unexpected error:",
      e && e.stack ? e.stack : e
    );
    return null;
  }
}

module.exports = {
  obterMidiaDaMensagem,
};
