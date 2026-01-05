const fs = require("fs");

async function tryDownloadMedia(message) {
  if (!message) return null;
  if (typeof message.downloadMedia === "function") {
    try {
      const media = await message.downloadMedia().catch(() => null);
      if (media) {
        // media may be an object with .data (base64 string), or .buffer (Buffer),
        // or a data URI string. Normalize all cases to a Buffer.
        let buffer = null;
        let base64 = null;
        if (typeof media === "string") {
          const s = media;
          base64 = s.includes("base64,") ? s.split("base64,").pop() : s;
          try {
            buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
          } catch (e) {
            buffer = null;
          }
        } else if (media.data && typeof media.data === "string") {
          base64 = media.data.includes("base64,")
            ? media.data.split("base64,").pop()
            : media.data;
          try {
            buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
          } catch (e) {
            buffer = null;
          }
        } else if (media.buffer && Buffer.isBuffer(media.buffer)) {
          buffer = media.buffer;
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
      }
    } catch (e) {
      console.warn(
        "[mediaHelper] downloadMedia failed:",
        e && e.message ? e.message : e
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
      }
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function obterMidiaDaMensagem(message) {
  // Try downloadMedia first
  const fromDownload = await tryDownloadMedia(message);
  if (fromDownload) return fromDownload;

  // Try direct fields
  const fromData = fromMessageData(message);
  if (fromData) return fromData;

  // No media available
  return null;
}

module.exports = {
  obterMidiaDaMensagem,
};
