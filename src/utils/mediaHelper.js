const fs = require("fs");

async function tryDownloadMedia(message) {
  if (!message) return null;
  if (typeof message.downloadMedia === "function") {
    try {
      const media = await message.downloadMedia().catch(() => null);
      if (media && (media.data || media.buffer)) {
        const buffer = media.data
          ? Buffer.from(media.data, "base64")
          : media.buffer || null;
        return {
          buffer,
          base64: media.data || null,
          mimetype: media.mimetype || media.mimeType || null,
          filename: media.filename || media.fileName || null,
          filesize: buffer ? buffer.length : null,
          origin: "downloadMedia",
        };
      }
    } catch (e) {
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
