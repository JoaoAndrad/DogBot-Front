/**
 * Flow Builder - DSL for defining interactive menu flows
 *
 * Example:
 * const flow = createFlow('test', {
 *   root: {
 *     title: 'Main Menu',
 *     options: [
 *       { label: 'Option 1', action: 'goto', target: '/option1' },
 *       { label: 'Option 2', action: 'exec', handler: 'doSomething' }
 *     ]
 *   },
 *   '/option1': {
 *     title: 'Submenu',
 *     options: [
 *       { label: 'Back', action: 'back' }
 *     ]
 *   },
 *   handlers: {
 *     doSomething: async (ctx) => {
 *       await ctx.reply('Done!');
 *       return { end: true };
 *     }
 *   }
 * });
 */

/**
 * Create a flow definition
 * @param {string} flowId - Unique identifier for this flow
 * @param {object} definition - Flow tree definition
 * @returns {object} Flow object
 */
function createFlow(flowId, definition) {
  const nodes = {};
  const handlers = definition.handlers || {};

  // Convert flat definition to nodes map
  for (const [path, node] of Object.entries(definition)) {
    if (path === "handlers") continue;

    // Normalize path (root -> /)
    const normalizedPath = path === "root" ? "/" : path;

    nodes[normalizedPath] = {
      title: node.title,
      options: node.options || [],
      dynamic: node.dynamic || false,
      handler: node.handler || null,
    };
  }

  return {
    flowId,
    nodes,
    handlers,
  };
}

/**
 * Validate flow definition
 * @param {object} flow
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validateFlow(flow) {
  const errors = [];

  if (!flow.flowId) {
    errors.push("Flow must have flowId");
  }

  if (!flow.nodes || Object.keys(flow.nodes).length === 0) {
    errors.push("Flow must have at least one node");
  }

  if (!flow.nodes["/"]) {
    errors.push("Flow must have a root (/) node");
  }

  // Validate all goto targets exist or are dynamic
  for (const [path, node] of Object.entries(flow.nodes)) {
    if (node.options) {
      for (const option of node.options) {
        if (option.action === "goto" && !flow.nodes[option.target]) {
          errors.push(
            `Node ${path} references non-existent target: ${option.target}`
          );
        }
        if (option.action === "exec" && !flow.handlers[option.handler]) {
          errors.push(
            `Node ${path} references non-existent handler: ${option.handler}`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  createFlow,
  validateFlow,
};
