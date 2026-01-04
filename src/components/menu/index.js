/**
 * Menu system for interactive poll-based navigation
 * Exports core components and utilities
 */

const flowManager = require("./flowManager");
const flowBuilder = require("./flowBuilder");
const storage = require("./storage");

module.exports = {
  flowManager,
  flowBuilder,
  storage,

  // Convenience exports
  createFlow: flowBuilder.createFlow,
  validateFlow: flowBuilder.validateFlow,
  registerFlow: (flow) => flowManager.registerFlow(flow),
  startFlow: (client, chatId, userId, flowId, opts) =>
    flowManager.startFlow(client, chatId, userId, flowId, opts),
};
