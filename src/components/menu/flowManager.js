const fetch = require("node-fetch");
const storage = require("./storage");
const logger = require("../../utils/logger");
const { validateFlow } = require("./flowBuilder");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/** Alinha com movieFlow/bookFlow: votos/menu podem gravar estado com UUID, texto vem com @c.us */
async function resolveUserUuidForMenu(externalId) {
  if (!externalId) return null;
  const s = String(externalId);
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ) {
    return s;
  }
  try {
    const url = `${BACKEND_URL}/api/users/by-identifier/${encodeURIComponent(
      externalId,
    )}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.user && json.user.id ? json.user.id : null;
  } catch (e) {
    return null;
  }
}

/**
 * FlowManager - Core engine for interactive menu navigation
 * Manages state, renders polls, and handles vote navigation
 */
class FlowManager {
  constructor() {
    this.flows = new Map(); // flowId -> flow definition
  }

  /**
   * Register a flow
   * @param {object} flow - Flow definition from flowBuilder
   */
  registerFlow(flow) {
    const validation = validateFlow(flow);
    if (!validation.valid) {
      throw new Error(
        `Invalid flow ${flow.flowId}: ${validation.errors.join(", ")}`,
      );
    }

    this.flows.set(flow.flowId, flow);
    console.log(`[FlowManager] Registered flow: ${flow.flowId}`);
  }

  /**
   * Start a flow for a user
   * @param {object} client - WhatsApp client
   * @param {string} chatId - Chat ID to send poll to
   * @param {string} userId - User ID for state tracking
   * @param {string} flowId - Flow to start
   * @param {object} options - { initialContext, initialPath, initialHistory }
   */
  async startFlow(client, chatId, userId, flowId, options = {}) {
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new Error(`Flow ${flowId} not found. Did you register it?`);
    }

    console.log(`[FlowManager] Starting flow ${flowId} for user ${userId}`);

    const initialPath =
      typeof options.initialPath === "string" && options.initialPath.startsWith("/")
        ? options.initialPath
        : "/";
    const initialHistory = Array.isArray(options.initialHistory)
      ? options.initialHistory
      : [];

    // Save initial state
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await storage.saveState(userId, flowId, {
      path: initialPath,
      history: initialHistory,
      context: options.initialContext || {},
      expiresAt: expiresAt.toISOString(),
    });

    await this._renderNode(client, chatId, userId, flowId, initialPath);
  }

  /**
   * Handle a vote in a flow
   * @param {object} client - WhatsApp client
   * @param {string} chatId - Chat ID
   * @param {string} userId - User ID (voter)
   * @param {object} pollMeta - { flowId, path } from poll metadata
   * @param {number} selectedIndex - Index of selected option
   */
  async handleVote(client, chatId, userId, pollMeta, selectedIndex) {
    const { flowId, path } = pollMeta;

    console.log(
      `[FlowManager] Vote received: ${flowId}${path} option ${selectedIndex} by ${userId}`,
    );

    const state = await storage.getState(userId, flowId);
    if (!state) {
      console.log(
        `[FlowManager] No state found for ${userId}:${flowId} - may have expired`,
      );
      await client.sendMessage(
        chatId,
        "❌ Sessão expirada. Digite o comando novamente para começar.",
      );
      return;
    }

    const flow = this.flows.get(flowId);
    if (!flow) {
      console.log(`[FlowManager] Flow ${flowId} not registered`);
      return;
    }

    const node = flow.nodes[path];
    if (!node) {
      console.log(`[FlowManager] Node ${path} not found in flow ${flowId}`);
      return;
    }

    const option = node.options[selectedIndex];
    if (!option) {
      console.log(
        `[FlowManager] Invalid option index ${selectedIndex} for ${path}`,
      );
      return;
    }

    await this._executeOption(
      client,
      chatId,
      userId,
      flowId,
      state,
      option,
      path,
    );
  }

  /**
   * Execute an option action
   * @private
   */
  async _executeOption(
    client,
    chatId,
    userId,
    flowId,
    state,
    option,
    currentPath,
  ) {
    const flow = this.flows.get(flowId);

    if (option.action === "goto") {
      // Navigate to target
      state.history.push(currentPath);
      state.path = option.target;
      await storage.saveState(userId, flowId, state);
      await this._renderNode(client, chatId, userId, flowId, option.target);
    } else if (option.action === "back") {
      // Go back in history
      const prevPath = state.history.pop() || "/";
      state.path = prevPath;
      await storage.saveState(userId, flowId, state);
      await this._renderNode(client, chatId, userId, flowId, prevPath);
    } else if (option.action === "exec") {
      // Execute handler
      const handler = flow.handlers[option.handler];
      if (!handler) {
        console.log(`[FlowManager] Handler ${option.handler} not found`);
        await client.sendMessage(
          chatId,
          "❌ Erro interno: handler não encontrado",
        );
        return;
      }

      const pathBeforeHandler = state.path;

      const ctx = {
        userId,
        chatId,
        client,
        reply: (text) => client.sendMessage(chatId, text),
        flowId,
        state,
        data: option.data || {},
      };

      try {
        const result = await handler(ctx, option.data);

        if (result && result.end) {
          // End flow
          await storage.deleteState(userId, flowId);
          console.log(`[FlowManager] Flow ${flowId} ended for ${userId}`);
        } else {
          // Save updated state after handler execution
          await storage.saveState(userId, flowId, state);

          // Só re-renderiza outro nó se o handler mudou o path de navegação.
          // Se `currentPath` do metadata da enquete vier undefined, comparar com
          // pathBeforeHandler — senão state.path !== currentPath reenvia a mesma enquete.
          if (result && result.noRender) {
            return;
          }
          const compareFrom =
            currentPath != null ? currentPath : pathBeforeHandler;
          if (
            state.path &&
            state.path !== compareFrom
          ) {
            await this._renderNode(client, chatId, userId, flowId, state.path);
          }
        }
      } catch (err) {
        console.log(`[FlowManager] Handler error:`, err);
        await client.sendMessage(chatId, "❌ Erro ao executar ação");
      }
    }
  }

  /**
   * Render a node (send poll or execute handler)
   * @private
   */
  async _renderNode(client, chatId, userId, flowId, path) {
    const flow = this.flows.get(flowId);
    const node = flow.nodes[path];
    let renderTitle = node?.title;
    let renderOptions = node?.options;

    if (!node) {
      console.log(`[FlowManager] Node ${path} not found in flow ${flowId}`);
      await client.sendMessage(chatId, "❌ Erro: nó não encontrado");
      return;
    }

    // Load saved state for this flow
    const state = (await storage.getState(userId, flowId)) || {
      path: "/",
      history: [],
      context: {},
    };

    // If node is dynamic, resolve options first
    if (node.dynamic && node.handler) {
      const ctx = {
        userId,
        chatId,
        client,
        reply: (text) => client.sendMessage(chatId, text),
        flowId,
        state,
      };

      try {
        const result = await node.handler(ctx);

        if (result && result.end) {
          await storage.deleteState(userId, flowId);
          return;
        }

        if (result && result.title) {
          renderTitle = result.title;
        }

        if (result && result.options) {
          renderOptions = result.options;
        }

        // Só mensagem, sem enquete: envia o título e encerra o flow
        if (result && result.skipPoll === true && renderTitle) {
          await client.sendMessage(chatId, renderTitle);
          await storage.deleteState(userId, flowId);
          return;
        }
      } catch (err) {
        console.log(`[FlowManager] Dynamic node handler error:`, err);
        await client.sendMessage(chatId, "❌ Erro ao carregar opções");
        return;
      }
    }

    // If node has no options but has a handler, execute it directly
    if (
      (!renderOptions || renderOptions.length === 0) &&
      node.handler &&
      !node.dynamic
    ) {
      const handler = flow.handlers[node.handler];
      if (handler) {
        const ctx = {
          userId,
          chatId,
          client,
          reply: (text) => client.sendMessage(chatId, text),
          flowId,
          state,
        };

        try {
          const result = await handler(ctx);
          if (result && result.end) {
            await storage.deleteState(userId, flowId);
          }
        } catch (err) {
          console.log(`[FlowManager] Handler error:`, err);
          await client.sendMessage(chatId, "❌ Erro ao executar");
        }
      }
      return;
    }

    // Create poll with metadata for backend processing (WhatsApp requires at least 2 options)
    if (!renderOptions || renderOptions.length < 2) {
      await client.sendMessage(
        chatId,
        "❌ Sessão expirada ou contexto perdido. Use o comando novamente para começar.",
      );
      return;
    }

    const polls = require("../poll");
    const optionLabels = renderOptions.map((o) => o.label);

    // Build metadata with action mapping for each option
    const options = renderOptions.map((opt, index) => ({
      index,
      label: opt.label,
      action: opt.action, // 'exec', 'goto', 'back'
      handler: opt.handler, // handler name if action='exec'
      target: opt.target, // target path if action='goto'
      data: opt.data, // additional data for handler
    }));

    await polls.createPoll(client, chatId, renderTitle, optionLabels, {
      metadata: {
        actionType: "menu",
        flowId,
        path,
        userId, // Store who started the flow
        options, // All option configurations
      },
      // onVote removed - now processed via backend through processor.js
    });
  }

  /**
   * Get active flows for a user
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async getActiveFlows(userId) {
    return storage.listStates(userId);
  }

  /**
   * Cancel/end a flow for a user
   * @param {string} userId
   * @param {string} flowId
   */
  async endFlow(userId, flowId) {
    await storage.deleteState(userId, flowId);
    console.log(`[FlowManager] Flow ${flowId} cancelled for ${userId}`);
  }

  /**
   * Processa texto livre para ajuste de data de visualização (fluxo film-card).
   * O processador de mensagens do bot deve chamar isto para mensagens que não são comandos.
   * @returns {Promise<boolean>} true se a mensagem foi consumida
   */
  async handleOptionalTextMessage(client, chatId, userId, textBody) {
    const flowId = "film-card";
    const candidateIds = [];
    if (userId) candidateIds.push(userId);
    const resolvedUuid = await resolveUserUuidForMenu(userId);
    if (resolvedUuid && resolvedUuid !== userId) {
      candidateIds.push(resolvedUuid);
    }

    let state = null;
    let stateUserId = null;
    for (const id of candidateIds) {
      const s = await storage.getState(id, flowId);
      if (s?.context?.awaitingViewingDateText) {
        state = s;
        stateUserId = id;
        break;
      }
    }
    if (!state || !stateUserId) {
      return false;
    }

    const { parseViewingDatePtBr } = require("../../utils/parseViewingDatePtBr");
    const trimmed = String(textBody || "").trim();
    if (!trimmed) {
      await client.sendMessage(
        chatId,
        "❌ Mensagem vazia. Envie uma data (ex: 12/08/26 ou *ontem*).",
      );
      return true;
    }
    const parsed = parseViewingDatePtBr(trimmed);
    if (!parsed.ok) {
      await client.sendMessage(chatId, `❌ ${parsed.reason}`);
      return true;
    }
    state.context.awaitingViewingDateText = false;
    state.context.pendingViewingDateIso = parsed.date.toISOString();
    state.path = "/viewing-date-confirm";
    await storage.saveState(stateUserId, flowId, state);
    await this._renderNode(
      client,
      chatId,
      stateUserId,
      flowId,
      "/viewing-date-confirm",
    );
    return true;
  }
}

// Export singleton instance
module.exports = new FlowManager();
