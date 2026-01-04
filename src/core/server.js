const http = require("http");
const logger = require("../utils/logger");

let server = null;

function start(port = 3000) {
  if (server) return;
  server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(port, () => console.log(`HTTP server listening on ${port}`));
}

function stop() {
  if (!server) return;
  server.close();
  server = null;
}

module.exports = { start, stop };
