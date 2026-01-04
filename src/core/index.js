const logger = require("../utils/logger");
const config = require("./config");

async function start({ bot }) {
  console.log("core: starting services");
  // start optional http server for health/metrics
  try {
    const server = require("./server");
    server.start(config.port);
  } catch (e) {
    console.log(
      "core: server module missing or failed to start",
      e && e.message
    );
  }

  console.log("core: started");
}

async function stop() {
  console.log("core: stopping services");
}

module.exports = { start, stop };
