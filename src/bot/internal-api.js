const http = require("http");
const logger = require("../utils/logger");
const bootLog = require("../lib/bootLog");

let server = null;

async function startInternalApi(client, opts = {}) {
  if (server) return server;
  const PORT = Number(opts.port || process.env.INTERNAL_API_PORT || 3001);
  // 0.0.0.0: aceita ligações de fora do container (backend noutro host precisa disto).
  // Em dev local podes forçar 127.0.0.1 com INTERNAL_API_BIND=127.0.0.1
  const HOST = process.env.INTERNAL_API_BIND || "0.0.0.0";
  const SECRET = opts.secret || process.env.POLL_SHARED_SECRET;

  server = http.createServer(async (req, res) => {
    try {
      const { method, url, headers } = req;

      // basic secret check
      const incomingSecret =
        headers["x-internal-secret"] || headers["X-Internal-Secret"];
      if (!SECRET || incomingSecret !== SECRET) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "forbidden" }));
        return;
      }

      if (method === "GET" && url.split("?")[0] === "/internal/whatsapp-status") {
        const info = client && client.info;
        const whatsappReady = Boolean(info);
        let phone = null;
        try {
          if (info && info.wid && info.wid.user != null) {
            phone = String(info.wid.user);
          }
        } catch (e) {
          /* ignore */
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ ok: true, whatsappReady, phone }),
        );
        return;
      }

      if (method === "POST" && url === "/internal/send-poll") {
        let body = "";
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          // limit body to 1MB
          if (size > 1e6) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "payload too large" }));
            return;
          }
          body += chunk;
        }

        let data = {};
        try {
          data = JSON.parse(body || "{}");
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid json" }));
          return;
        }

        const chatId = data.chatId || data.to;
        const title = data.title || data.question || data.q;
        const options = Array.isArray(data.options)
          ? data.options
          : data.choices || data.opts || [];

        if (!chatId || !title || !options.length) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              error: "Missing chatId/title/options",
            }),
          );
          return;
        }

        console.log("Internal API: send-poll", { chatId, title, options });

        try {
          const polls = require("../components/poll");
          const result = await polls.createPoll(
            client,
            chatId,
            title,
            options,
            {
              onVote: async ({
                messageId,
                poll,
                voter,
                selectedIndexes,
                selectedNames,
              }) => {
                const opts =
                  poll &&
                  (poll.options ||
                    (poll.pollOptions && poll.pollOptions.map((o) => o.name)));
                const chosen =
                  (selectedNames && selectedNames[0]) ||
                  (selectedIndexes &&
                    selectedIndexes[0] != null &&
                    opts &&
                    opts[selectedIndexes[0]]) ||
                  null;
                // only log votes from the internal API — do not send chat messages
                console.log("internal-api: poll onVote", {
                  messageId,
                  voter,
                  chosen,
                  selectedIndexes,
                  selectedNames,
                });
              },
            },
          );

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, result }));
        } catch (err) {
          const errMsg = err && (err.stack || err.message || String(err));
          console.log("Internal API createPoll failed", errMsg);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        }
        return;
      }

      if (method === "POST" && url === "/internal/send-message") {
        let body = "";
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1e5) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "payload too large" }));
            return;
          }
          body += chunk;
        }

        let data = {};
        try {
          data = JSON.parse(body || "{}");
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid json" }));
          return;
        }

        const chatId = data.chatId;
        const message = data.message;

        if (!chatId || !message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ ok: false, error: "Missing chatId or message" }),
          );
          return;
        }

        try {
          await client.sendMessage(chatId, message);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          const errMsg = err && (err.stack || err.message || String(err));
          console.log("Internal API send-message failed", errMsg);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: errMsg }));
        }
        return;
      }

      // unknown route
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
    } catch (err) {
      console.log("Internal API handler error", err && err.message);
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      } catch (e) {}
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, (err) => {
      if (err) return reject(err);
      bootLog.line("internal", {
        ok: true,
        extra: `http://${HOST}:${PORT}`,
      });
      resolve();
    });
  });

  return server;
}

async function stopInternalApi() {
  if (!server) return;
  await new Promise((resolve) => {
    try {
      server.close(() => {
        logger.info("Internal API stopped");
        server = null;
        resolve();
      });
    } catch (e) {
      server = null;
      resolve();
    }
  });
}

module.exports = { startInternalApi, stopInternalApi };
