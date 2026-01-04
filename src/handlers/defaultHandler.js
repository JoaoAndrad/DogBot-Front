module.exports = async function defaultHandler(context) {
  const logger = require("../utils/logger");
  console.log("defaultHandler: message received", {
    body: context.info && context.info.body,
  });
  // noop default
  return false;
};
