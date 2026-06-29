const storage = require("./storage");
const logger = require("../../utils/logger");
const bootLog = require("../../lib/bootLog");
const { validateFlow } = require("./flowBuilder");
const resolveUserUuidForMenu = require("../../utils/whatsapp/resolveUserUuidForMenu");

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
    bootLog.debug(`flow ${flow.flowId}`);
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

    logger.debug(`[FlowManager] Iniciando flow ${flowId} para ${userId}`);

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
   * @param {object} [resolvedOption] - Opção completa vinda da metadata da enquete (obrigatória para nós `dynamic` com options vazias no flow)
   */
  async handleVote(client, chatId, userId, pollMeta, selectedIndex, resolvedOption) {
    const { flowId, path } = pollMeta;

    logger.debug(
      `[FlowManager] Voto: ${flowId}${path} opção ${selectedIndex} por ${userId}`,
    );

    const state = await storage.getState(userId, flowId);
    if (!state) {
      logger.debug(
        `[FlowManager] Sem estado para ${userId}:${flowId} (expirado?)`,
      );
      await client.sendMessage(
        chatId,
        "❌ Sessão expirada. Digite o comando novamente para começar.",
      );
      return;
    }

    const flow = this.flows.get(flowId);
    if (!flow) {
      logger.warn(`[FlowManager] Flow ${flowId} não registado`);
      return;
    }

    const node = flow.nodes[path];
    if (!node) {
      logger.warn(`[FlowManager] Nó ${path} inexistente no flow ${flowId}`);
      return;
    }

    const option =
      resolvedOption ||
      (Array.isArray(node.options) ? node.options[selectedIndex] : undefined);
    if (!option) {
      logger.warn(
        `[FlowManager] Opção inválida ${selectedIndex} para ${path} (nós dinâmicos: resolvedOption)`,
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
      selectedIndex,
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
    selectedIndex,
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
        logger.error(`[FlowManager] Handler ${option.handler} não encontrado`);
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
        option,
      };

      const handlerMeta = { option, selectedIndex };

      try {
        const result = await handler(
          ctx,
          option.data || {},
          handlerMeta,
        );

        if (result && result.end) {
          // End flow
          await storage.deleteState(userId, flowId);
          logger.debug(`[FlowManager] Flow ${flowId} terminou para ${userId}`);
        } else {
          // Save updated state after handler execution
          await storage.saveState(userId, flowId, state);

          // Só re-renderiza outro nó se o handler mudou o path de navegação.
          // Se `currentPath` do metadata da enquete vier undefined, comparar com
          // pathBeforeHandler — senão state.path !== currentPath reenvia a mesma enquete.
          if (result && result.noRender) {
            return;
          }
          if (result && result.rerenderCurrent) {
            await this._renderNode(
              client,
              chatId,
              userId,
              flowId,
              state.path,
            );
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
        logger.error(`[FlowManager] Erro no handler:`, err);
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
      logger.warn(`[FlowManager] Nó ${path} inexistente no flow ${flowId}`);
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

        // Persiste qualquer modificação que o handler dinâmico tenha feito no contexto
        await storage.saveState(userId, flowId, state);
      } catch (err) {
        logger.error(`[FlowManager] Erro no handler de nó dinâmico:`, err);
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
          logger.error(`[FlowManager] Erro no handler:`, err);
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
    logger.debug(`[FlowManager] Flow ${flowId} cancelado para ${userId}`);
  }

  /**
   * Intercepta mensagens que se parecem com comandos financeiros (NLP).
   * Roda DEPOIS de _handleFinancialTextInput (que tem prioridade quando há awaiting flags).
   * @private
   * @returns {Promise<boolean>} true se consumido
   */
  async _handleFinancialNlp(client, chatId, userId, textBody, candidateIds) {
    const { parse, parseQuery } = require("../../utils/parses/parseFinancialCommandPtBr");
    const raw = String(textBody || "").trim();
    const parsed = parse(raw) || parseQuery(raw);
    if (!parsed) return false;

    // ── Consultas NLP ──────────────────────────────────────────────────────────
    if (parsed.intent === "query") {
      return this._handleFinancialQuery(client, chatId, candidateIds, parsed.queryType);
    }

    if (!["expense", "income", "future_expense", "future_income"].includes(parsed.intent)) return false;
    if (!parsed.amount || parsed.amount <= 0) return false;

    const financialClient = require("../../services/financialClient");

    // Find the first candidate ID that has a linked vault
    let resolvedId = null;
    for (const id of candidateIds) {
      try {
        const s = await financialClient.checkAuthStatus(id);
        if (s?.linked) { resolvedId = id; break; }
      } catch (e) { /* continue */ }
    }
    if (!resolvedId) return false;

    // Get accounts to find default
    let defaultAccount = null;
    try {
      const res = await financialClient.listAccounts(resolvedId);
      const accounts = res?.accounts || [];
      if (!accounts.length) return false;
      defaultAccount = accounts.find(a => a.isDefault) || accounts[0];
    } catch (e) {
      return false;
    }

    const type = parsed.intent.includes("income") ? "income" : "expense";
    const isPending = !!parsed.isPending;
    const installmentCount = (parsed.installmentCount && parsed.installmentCount >= 2) ? parsed.installmentCount : null;
    const recurrence = parsed.recurrence || null;
    const recurrenceDay = parsed.recurrenceDay != null ? parsed.recurrenceDay : null;
    const pendingNlpTransaction = {
      type,
      amount: parsed.amount,
      description: parsed.description || null,
      date: (parsed.date || new Date()).toISOString(),
      isPending,
      installmentCount,
      recurrence,
      recurrenceDay,
      accountId: defaultAccount.id,
      accountName: defaultAccount.name,
    };

    // Upsert financeiro flow state pointing at /nlp-confirm
    const existing = await storage.getState(resolvedId, "financeiro") || {
      path: "/nlp-confirm",
      history: [],
      context: {},
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    existing.context.pendingNlpTransaction = pendingNlpTransaction;
    existing.path = "/nlp-confirm";
    await storage.saveState(resolvedId, "financeiro", existing);
    await this._renderNode(client, chatId, resolvedId, "financeiro", "/nlp-confirm");
    return true;
  }

  /**
   * Responde consultas NLP financeiras diretamente como texto, sem abrir menu.
   * @private
   * @returns {Promise<boolean>} true se consumido
   */
  async _handleFinancialQuery(client, chatId, candidateIds, queryType) {
    const financialClient = require("../../services/financialClient");

    let resolvedId = null;
    for (const id of candidateIds) {
      try {
        const s = await financialClient.checkAuthStatus(id);
        if (s?.linked) { resolvedId = id; break; }
      } catch (e) { /* continue */ }
    }
    if (!resolvedId) return false;

    function fmt(n) {
      return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtDate(d) {
      const dt = new Date(d);
      return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
    }

    try {
      if (queryType === "balance") {
        const res = await financialClient.listAccounts(resolvedId);
        const accounts = res?.accounts || [];
        if (!accounts.length) {
          await client.sendMessage(chatId, "🏦 Você ainda não tem contas cadastradas.");
          return true;
        }
        const total = accounts.reduce((s, a) => s + (a.balance || 0), 0);
        const totalProjected = accounts.reduce((s, a) => s + (a.projectedBalance ?? a.balance ?? 0), 0);
        const lines = accounts.map(a => {
          const sign = a.balance < 0 ? "🔴" : "🟢";
          let line = `${sign} *${a.name}*: R$ ${fmt(a.balance)}`;
          if (a.projectedBalance != null && Math.abs(a.projectedBalance - a.balance) >= 0.01) {
            line += `  _(projetado: R$ ${fmt(a.projectedBalance)})_`;
          }
          return line;
        });
        const hasPending = Math.abs(totalProjected - total) >= 0.01;
        await client.sendMessage(chatId,
          `🏦 *Seus saldos:*\n\n${lines.join("\n")}\n\n` +
          `💰 *Total: R$ ${fmt(total)}*` +
          (hasPending ? `\n📈 *Projetado: R$ ${fmt(totalProjected)}*` : "")
        );
        return true;
      }

      if (queryType === "expenses" || queryType === "income") {
        const res = await financialClient.listTransactions(resolvedId, { period: "current", limit: 500 });
        const txs = (res?.transactions || []).filter(t => t.status === "confirmed");
        const filtered = txs.filter(t => t.type === (queryType === "expenses" ? "expense" : "income"));
        const total = filtered.reduce((s, t) => s + (t.amount || 0), 0);
        const emoji = queryType === "expenses" ? "🔴" : "🟢";
        const label = queryType === "expenses" ? "Gastos" : "Receitas";
        if (!filtered.length) {
          await client.sendMessage(chatId, `${emoji} Nenhuma ${label.toLowerCase().slice(0, -1)} registrada este mês.`);
          return true;
        }
        const top5 = filtered.slice(0, 5).map(t => {
          const desc = t.description || (queryType === "expenses" ? "Despesa" : "Receita");
          return `• ${fmtDate(t.date)}  R$ ${fmt(t.amount)}  ${desc}`;
        });
        const more = filtered.length > 5 ? `\n_...e mais ${filtered.length - 5} lançamento(s)_` : "";
        await client.sendMessage(chatId,
          `${emoji} *${label} deste mês:*\n\n${top5.join("\n")}${more}\n\n` +
          `*Total: R$ ${fmt(total)}*`
        );
        return true;
      }

      if (queryType === "scheduled") {
        const res = await financialClient.listScheduled(resolvedId);
        const txs = res?.transactions || [];
        if (!txs.length) {
          await client.sendMessage(chatId, "📅 Nenhum agendamento pendente.");
          return true;
        }
        const lines = txs.slice(0, 8).map(t => {
          const emoji = t.type === "income" ? "🟢" : "🔴";
          const sign = t.type === "income" ? "+" : "-";
          const desc = t.description || (t.type === "income" ? "Receita" : "Despesa");
          return `${emoji} ${fmtDate(t.date)}  ${sign}R$ ${fmt(t.amount)}  ${desc}`;
        });
        const more = txs.length > 8 ? `\n_...e mais ${txs.length - 8}_` : "";
        await client.sendMessage(chatId, `📅 *Agendamentos pendentes:*\n\n${lines.join("\n")}${more}`);
        return true;
      }

      if (queryType === "budget") {
        const res = await financialClient.listBudgets(resolvedId);
        const budgets = res?.budgets || [];
        if (!budgets.length) {
          await client.sendMessage(chatId, "📊 Você ainda não tem orçamentos configurados.");
          return true;
        }
        const lines = budgets.map(b => {
          const pct = b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
          const bar = "█".repeat(Math.min(Math.round(pct / 12.5), 8)) + "░".repeat(8 - Math.min(Math.round(pct / 12.5), 8));
          const emoji = pct >= 100 ? "🚨" : pct >= 80 ? "⚠️" : "✅";
          const cat = b.categoryName ? ` [${b.categoryName}]` : " [geral]";
          return `${emoji} ${bar} ${pct}%${cat}  R$ ${fmt(b.spent)} / R$ ${fmt(b.limit)}`;
        });
        await client.sendMessage(chatId, `📊 *Orçamentos deste mês:*\n\n${lines.join("\n")}`);
        return true;
      }
    } catch (e) {
      logger.warn("[FlowManager] _handleFinancialQuery error:", e.message);
    }
    return false;
  }

  /**
   * Processa input de texto livre do flow financeiro (add conta, categoria, orçamento).
   * @private
   * @returns {Promise<boolean>} true se consumido
   */
  async _handleFinancialTextInput(client, chatId, userId, textBody, candidateIds) {
    const flowId = "financeiro";
    let state = null;
    let stateUserId = null;
    for (const id of candidateIds) {
      const s = await storage.getState(id, flowId);
      if (s?.context?.awaitingAccountName || s?.context?.awaitingAccountBalance ||
          s?.context?.awaitingCategoryName || s?.context?.awaitingBudgetLimit ||
          s?.context?.awaitingEditName || s?.context?.awaitingEditBalance ||
          s?.context?.awaitingCardName || s?.context?.awaitingCardLimit ||
          s?.context?.awaitingCardClosingDay || s?.context?.awaitingCardDueDay ||
          s?.context?.awaitingPaymentAmount ||
          s?.context?.awaitingScheduleDesc || s?.context?.awaitingScheduleAmount ||
          s?.context?.awaitingScheduleDay ||
          s?.context?.awaitingTransferAmount ||
          s?.context?.awaitingEditTxAmount || s?.context?.awaitingEditTxDesc ||
          s?.context?.awaitingEditInstallmentAmount) {
        state = s;
        stateUserId = id;
        break;
      }
    }
    if (!state || !stateUserId) return false;

    const { parseAmount } = require("./flows/financialFlow");
    const trimmed = String(textBody || "").trim();

    if (state.context.awaitingAccountName) {
      if (!trimmed) {
        await client.sendMessage(chatId, "❌ Nome inválido. Envie o nome da conta:");
        return true;
      }
      state.context.pendingAccountName = trimmed;
      state.context.awaitingAccountName = false;
      state.context.awaitingAccountBalance = true;
      await storage.saveState(stateUserId, flowId, state);
      await client.sendMessage(chatId, "✏️ Digite o *saldo inicial* em R$ (ex: 1500 ou 0 para começar do zero):");
      return true;
    }

    if (state.context.awaitingAccountBalance) {
      const amount = parseAmount(trimmed);
      if (amount === null) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o saldo em R$ (ex: 1500 ou 0):");
        return true;
      }
      state.context.pendingAccountBalance = amount;
      state.context.awaitingAccountBalance = false;
      state.path = "/contas/confirmar";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/contas/confirmar");
      return true;
    }

    if (state.context.awaitingCategoryName) {
      if (!trimmed) {
        await client.sendMessage(chatId, "❌ Nome inválido. Envie o nome da categoria:");
        return true;
      }
      state.context.pendingCategoryName = trimmed;
      state.context.awaitingCategoryName = false;
      state.context.pendingCategoryParentId = null;
      state.context.pendingCategoryParentName = null;
      state.path = "/categorias/tipo";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/categorias/tipo");
      return true;
    }

    if (state.context.awaitingEditName) {
      if (!trimmed) {
        await client.sendMessage(chatId, "❌ Nome inválido. Envie o novo nome:");
        return true;
      }
      state.context.pendingEditName = trimmed;
      state.context.awaitingEditName = false;
      state.path = "/contas/editar/confirmar";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/contas/editar/confirmar");
      return true;
    }

    if (state.context.awaitingEditBalance) {
      const amount = parseAmount(trimmed);
      if (amount === null) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o novo saldo em R$ (ex: 1500 ou 0):");
        return true;
      }
      state.context.pendingEditBalance = amount;
      state.context.awaitingEditBalance = false;
      state.path = "/contas/editar/saldo-ajuste";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/contas/editar/saldo-ajuste");
      return true;
    }

    if (state.context.awaitingBudgetLimit) {
      const amount = parseAmount(trimmed);
      if (amount === null || amount <= 0) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o limite em R$ (ex: 1500):");
        return true;
      }
      state.context.pendingBudgetLimit = amount;
      state.context.awaitingBudgetLimit = false;
      state.path = "/orcamentos/confirmar";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/orcamentos/confirmar");
      return true;
    }

    // ── Cartões ────────────────────────────────────────────────────────────

    if (state.context.awaitingCardName) {
      if (!trimmed) {
        await client.sendMessage(chatId, "❌ Nome inválido. Envie o nome do cartão:");
        return true;
      }
      state.context.pendingCardName = trimmed;
      state.context.awaitingCardName = false;
      state.context.awaitingCardLimit = true;
      await storage.saveState(stateUserId, flowId, state);
      await client.sendMessage(chatId, "✏️ Digite o *limite* do cartão em R$ (ex: 5000 ou 5.000,00):");
      return true;
    }

    if (state.context.awaitingCardLimit) {
      const amount = parseAmount(trimmed);
      if (amount === null || amount <= 0) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o limite em R$ (ex: 5000):");
        return true;
      }
      state.context.pendingCardLimit = amount;
      state.context.awaitingCardLimit = false;
      state.context.awaitingCardClosingDay = true;
      await storage.saveState(stateUserId, flowId, state);
      await client.sendMessage(chatId, "📅 Dia de *fechamento* da fatura (1–31):");
      return true;
    }

    if (state.context.awaitingCardClosingDay) {
      const day = parseInt(trimmed, 10);
      if (isNaN(day) || day < 1 || day > 31) {
        await client.sendMessage(chatId, "❌ Dia inválido. Digite um número entre 1 e 31:");
        return true;
      }
      state.context.pendingCardClosingDay = day;
      state.context.awaitingCardClosingDay = false;
      state.context.awaitingCardDueDay = true;
      await storage.saveState(stateUserId, flowId, state);
      await client.sendMessage(chatId, "📅 Dia de *vencimento* da fatura (1–31):");
      return true;
    }

    if (state.context.awaitingCardDueDay) {
      const day = parseInt(trimmed, 10);
      if (isNaN(day) || day < 1 || day > 31) {
        await client.sendMessage(chatId, "❌ Dia inválido. Digite um número entre 1 e 31:");
        return true;
      }
      state.context.pendingCardDueDay = day;
      state.context.awaitingCardDueDay = false;
      state.path = "/cartoes/vincular";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/cartoes/vincular");
      return true;
    }

    if (state.context.awaitingPaymentAmount) {
      const amount = parseAmount(trimmed);
      if (amount === null || amount <= 0) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o valor a pagar em R$ (ex: 320 ou 320,00):");
        return true;
      }
      state.context.pendingPaymentAmount = amount;
      state.context.awaitingPaymentAmount = false;
      state.path = "/cartoes/pagar/confirmar";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/cartoes/pagar/confirmar");
      return true;
    }

    // ── Novo agendamento ───────────────────────────────────────────────────

    if (state.context.awaitingScheduleDesc) {
      if (!trimmed) {
        await client.sendMessage(chatId, "❌ Descrição inválida. Envie o nome do agendamento:");
        return true;
      }
      state.context.pendingScheduleDesc = trimmed;
      state.context.awaitingScheduleDesc = false;
      state.context.awaitingScheduleAmount = true;
      await storage.saveState(stateUserId, flowId, state);
      await client.sendMessage(chatId, "💰 Digite o *valor* em R$ (ex: 1500 ou 1.500,00):");
      return true;
    }

    if (state.context.awaitingScheduleAmount) {
      const amount = parseAmount(trimmed);
      if (amount === null || amount <= 0) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o valor em R$ (ex: 1500):");
        return true;
      }
      state.context.pendingScheduleAmount = amount;
      state.context.awaitingScheduleAmount = false;
      state.path = "/agendamentos/novo/recorrencia";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/agendamentos/novo/recorrencia");
      return true;
    }

    if (state.context.awaitingScheduleDay) {
      const day = parseInt(trimmed, 10);
      if (isNaN(day) || day < 1 || day > 31) {
        await client.sendMessage(chatId, "❌ Dia inválido. Digite um número entre 1 e 31:");
        return true;
      }
      state.context.pendingScheduleDay = day;
      state.context.awaitingScheduleDay = false;
      state.path = "/agendamentos/novo/conta";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/agendamentos/novo/conta");
      return true;
    }

    // ── Transferência ──────────────────────────────────────────────────────

    if (state.context.awaitingTransferAmount) {
      const amount = parseAmount(trimmed);
      if (amount === null || amount <= 0) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o valor a transferir em R$ (ex: 500):");
        return true;
      }
      state.context.pendingTransferAmount = amount;
      state.context.awaitingTransferAmount = false;
      state.path = "/transferencia/confirmar";
      await storage.saveState(stateUserId, flowId, state);
      await this._renderNode(client, chatId, stateUserId, flowId, "/transferencia/confirmar");
      return true;
    }

    // ── Edição de lançamentos ──────────────────────────────────────────────

    if (state.context.awaitingEditTxAmount) {
      const amount = parseAmount(trimmed);
      if (amount === null || amount <= 0) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o valor em R$ (ex: 150):");
        return true;
      }
      state.context.awaitingEditTxAmount = false;
      await storage.saveState(stateUserId, flowId, state);
      const financialClient = require("../../services/financialClient");
      try {
        await financialClient.updateTransaction(stateUserId, state.context.editingTxId, { amount });
        state.context.editingTxAmount = amount;
        await storage.saveState(stateUserId, flowId, state);
        await client.sendMessage(chatId, "✅ Valor atualizado.");
      } catch (e) {
        await client.sendMessage(chatId, "❌ Erro ao atualizar valor.");
      }
      return true;
    }

    if (state.context.awaitingEditTxDesc) {
      if (!trimmed) {
        await client.sendMessage(chatId, "❌ Descrição inválida. Envie a nova descrição:");
        return true;
      }
      state.context.awaitingEditTxDesc = false;
      await storage.saveState(stateUserId, flowId, state);
      const financialClient = require("../../services/financialClient");
      try {
        await financialClient.updateTransaction(stateUserId, state.context.editingTxId, { description: trimmed });
        state.context.editingTxDescription = trimmed;
        await storage.saveState(stateUserId, flowId, state);
        await client.sendMessage(chatId, "✅ Descrição atualizada.");
      } catch (e) {
        await client.sendMessage(chatId, "❌ Erro ao atualizar descrição.");
      }
      return true;
    }

    // ── Edição de parcelas ─────────────────────────────────────────────────

    if (state.context.awaitingEditInstallmentAmount) {
      const amount = parseAmount(trimmed);
      if (amount === null || amount <= 0) {
        await client.sendMessage(chatId, "❌ Valor inválido. Digite o valor em R$ (ex: 150):");
        return true;
      }
      state.context.awaitingEditInstallmentAmount = false;
      await storage.saveState(stateUserId, flowId, state);
      const financialClient = require("../../services/financialClient");
      try {
        await financialClient.updateInstallments(stateUserId, state.context.editingTxInstallmentGroupId, {
          from: state.context.editingTxInstallmentNumber,
          amount,
        });
        state.context.editingTxAmount = amount;
        await storage.saveState(stateUserId, flowId, state);
        await client.sendMessage(chatId, "✅ Valor das parcelas atualizado.");
      } catch (e) {
        await client.sendMessage(chatId, "❌ Erro ao atualizar parcelas.");
      }
      return true;
    }

    return false;
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
    if (chatId && chatId !== userId) candidateIds.push(chatId);

    const resolvedUuid = await resolveUserUuidForMenu(userId);
    if (resolvedUuid && !candidateIds.includes(resolvedUuid)) {
      candidateIds.push(resolvedUuid);
    }
    const resolvedFromChat =
      chatId && chatId !== userId
        ? await resolveUserUuidForMenu(chatId)
        : null;
    if (resolvedFromChat && !candidateIds.includes(resolvedFromChat)) {
      candidateIds.push(resolvedFromChat);
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
      const financialHandled = await this._handleFinancialTextInput(client, chatId, userId, textBody, candidateIds);
      if (financialHandled) return true;
      const nlpHandled = await this._handleFinancialNlp(client, chatId, userId, textBody, candidateIds);
      if (nlpHandled) return true;
      return false;
    }

    const { parseViewingDatePtBr } = require("../../utils/parses/parseViewingDatePtBr");
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
    try {
      const conversationState = require("../../services/conversationState");
      for (const k of [userId, chatId, stateUserId]) {
        if (k && conversationState.getState(k)?.flowType === "film-viewing-date") {
          conversationState.clearState(k);
          break;
        }
      }
    } catch (e) {
      logger.warn("[film-card] clear conversationState:", e.message);
    }
    return true;
  }
}

// Export singleton instance
module.exports = new FlowManager();
