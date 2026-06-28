"use strict";

const { createFlow } = require("../flowBuilder");
const financialClient = require("../../../services/financialClient");
const logger = require("../../../utils/logger");

// ─── Formatação ──────────────────────────────────────────────────────────────

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(date) {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function progressBar(pct, width = 8) {
  const filled = Math.min(Math.round((Math.min(pct, 100) / 100) * width), width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function parseAmount(str) {
  const s = String(str || "").trim().replace(/[R$\s]/g, "");
  const normalized = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const val = parseFloat(normalized);
  return isNaN(val) || val < 0 ? null : Math.round(val * 100) / 100;
}

const ACCOUNT_TYPES = [
  { key: "corrente", label: "Conta corrente" },
  { key: "poupanca", label: "Poupança" },
  { key: "carteira", label: "Carteira" },
  { key: "investimento", label: "Investimento" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function checkLinked(userId) {
  try {
    const res = await financialClient.checkAuthStatus(userId);
    return !!(res && res.linked);
  } catch (e) {
    logger.warn("[financialFlow] checkAuthStatus error:", e.message);
    return false;
  }
}

async function notifyLinked(client, chatId, userId) {
  const flowManager = require("../flowManager");
  await client.sendMessage(
    chatId,
    "✅ *Conta vinculada com sucesso!*\n\nSeu cofre financeiro foi criado com categorias padrão configuradas.\n\nAbrindo o menu financeiro…"
  );
  try {
    await flowManager.startFlow(client, chatId, userId, "financeiro");
  } catch (e) {
    logger.warn("[financialFlow] startFlow after link error:", e.message);
  }
}

function pollAuthStatus(client, chatId, userId, maxAttempts = 36, intervalMs = 5000) {
  let attempts = 0;
  let done = false;

  async function check() {
    if (done) return;
    try {
      const linked = await checkLinked(userId);
      if (linked) {
        done = true;
        clearInterval(timer);
        await notifyLinked(client, chatId, userId);
      }
    } catch (e) {
      logger.warn("[financialFlow] poll error:", e.message);
    }
    if (attempts >= maxAttempts) {
      done = true;
      clearInterval(timer);
    }
  }

  check();

  const timer = setInterval(() => {
    attempts++;
    check();
  }, intervalMs);
}

// ─── Flow ────────────────────────────────────────────────────────────────────

const financialFlow = createFlow("financeiro", {

  // ── Root ──────────────────────────────────────────────────────────────────

  root: {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const linked = await checkLinked(ctx.userId);
      if (!linked) {
        return {
          title: "💰 Assistente Financeiro",
          options: [
            { label: "🚀 Primeiros passos", action: "goto", target: "/onboarding" },
            { label: "❓ Dúvidas", action: "goto", target: "/duvidas" },
            { label: "✖️ Fechar", action: "exec", handler: "close" },
          ],
        };
      }
      return {
        title: "💰 Assistente Financeiro",
        options: [
          { label: "📋 Extrato", action: "goto", target: "/extrato" },
          { label: "🏦 Contas", action: "goto", target: "/contas" },
          { label: "🏷️ Categorias", action: "goto", target: "/categorias" },
          { label: "📊 Orçamentos", action: "goto", target: "/orcamentos" },
          { label: "⚙️ Configurações", action: "goto", target: "/config" },
          { label: "❓ Dúvidas", action: "goto", target: "/duvidas" },
          { label: "✖️ Fechar", action: "exec", handler: "close" },
        ],
      };
    },
  },

  // ── Onboarding / OAuth ────────────────────────────────────────────────────

  "/onboarding": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await ctx.reply(
        "💰 *Assistente Financeiro — Primeiros passos*\n\n" +
        "Para proteger seus dados financeiros, usamos criptografia de ponta a ponta vinculada à sua conta Google.\n\n" +
        "• Seus dados ficam criptografados no servidor\n" +
        "• Nenhum desenvolvedor pode acessá-los\n" +
        "• O login Google é feito apenas uma vez\n\n" +
        "Quer conectar sua conta Google agora?"
      );
      return {
        title: "Conectar conta Google?",
        options: [
          { label: "✅ Sim, conectar agora", action: "exec", handler: "startOAuth" },
          { label: "↩️ Voltar", action: "back" },
        ],
      };
    },
  },

  // ── Extrato ───────────────────────────────────────────────────────────────

  "/extrato": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      try {
        const res = await financialClient.listTransactions(ctx.userId, { period: "all", limit: 1 });
        if (!res?.transactions?.length) {
          await ctx.reply("📋 Você ainda não tem nenhuma transação registrada.");
          return {
            title: "O que deseja fazer?",
            options: [
              { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
              { label: "✖️ Fechar", action: "exec", handler: "close" },
            ],
          };
        }
      } catch (e) {
        logger.warn("[financialFlow] /extrato check error:", e.message);
      }
      return {
        title: "📋 Extrato — período",
        options: [
          { label: "📅 Este mês", action: "exec", handler: "extratoMes", data: { period: "current" } },
          { label: "📅 Mês anterior", action: "exec", handler: "extratoMes", data: { period: "last" } },
          { label: "↩️ Voltar", action: "back" },
        ],
      };
    },
  },

  "/extrato/ver": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { extratoPeriod = "current", extratoPage = 0 } = ctx.state.context;
      const limit = 10;
      const skip = extratoPage * limit;
      const periodLabel = extratoPeriod === "last" ? "Mês passado" : "Este mês";

      try {
        const res = await financialClient.listTransactions(ctx.userId, {
          period: extratoPeriod,
          limit: limit + 1,
          skip,
        });

        if (!res?.transactions?.length) {
          await ctx.reply(`📋 Nenhuma transação em *${periodLabel.toLowerCase()}*.`);
          return {
            title: "Extrato vazio",
            options: [
              { label: "🔄 Trocar período", action: "goto", target: "/extrato" },
              { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
            ],
          };
        }

        const { transactions, summary } = res;
        const hasNext = transactions.length > limit;
        const hasPrev = extratoPage > 0;
        const txs = transactions.slice(0, limit);

        const lines = [`📋 *Extrato — ${periodLabel}* (pág. ${extratoPage + 1})\n`];
        if (extratoPage === 0 && summary) {
          lines.push(
            `🟢 Entradas: R$ ${formatMoney(summary.income)}`,
            `🔴 Saídas:   R$ ${formatMoney(summary.expense)}`,
            `💰 Saldo:    R$ ${formatMoney(summary.net)}\n`,
          );
        }
        for (const t of txs) {
          const emoji = t.type === "income" ? "🟢" : "🔴";
          const sign = t.type === "income" ? "+" : "-";
          const desc = t.description || (t.type === "income" ? "Receita" : "Despesa");
          const cat = t.categoryName ? ` [${t.categoryName}]` : "";
          lines.push(`${emoji} ${formatDate(t.date)}  ${sign}R$ ${formatMoney(t.amount)}  ${desc}${cat}`);
        }
        await ctx.reply(lines.join("\n"));

        const options = [];
        if (hasPrev) options.push({ label: "⬅️ Página anterior", action: "exec", handler: "extratoPagePrev" });
        if (hasNext) options.push({ label: "➡️ Próxima página", action: "exec", handler: "extratoPageNext" });
        options.push({ label: "🔄 Trocar período", action: "goto", target: "/extrato" });
        options.push({ label: "↩️ Voltar ao menu", action: "goto", target: "/" });
        return { title: `Extrato — página ${extratoPage + 1}`, options };
      } catch (e) {
        logger.error("[financialFlow] extrato/ver error:", e.message);
        await ctx.reply("❌ Erro ao carregar extrato. Tente novamente.");
        return {
          title: "Erro",
          options: [
            { label: "🔄 Tentar novamente", action: "exec", handler: "extratoReload" },
            { label: "↩️ Voltar", action: "back" },
          ],
        };
      }
    },
  },

  // ── Contas ────────────────────────────────────────────────────────────────

  "/contas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let hasAccounts = false;
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        hasAccounts = !!(res?.accounts?.length);
      } catch (e) {
        logger.warn("[financialFlow] /contas check error:", e.message);
      }
      const options = [];
      if (hasAccounts) options.push({ label: "📋 Ver contas", action: "exec", handler: "listarContas" });
      if (hasAccounts) options.push({ label: "✏️ Editar conta", action: "goto", target: "/contas/editar" });
      options.push({ label: "➕ Adicionar conta", action: "goto", target: "/contas/tipo" });
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: "🏦 Contas bancárias", options };
    },
  },

  "/contas/editar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        const accounts = res?.accounts || [];
        if (!accounts.length) {
          await ctx.reply("🏦 Nenhuma conta para editar.");
          return {
            title: "Contas",
            options: [
              { label: "➕ Adicionar conta", action: "goto", target: "/contas/tipo" },
              { label: "↩️ Voltar", action: "back" },
            ],
          };
        }
        const options = accounts.map(a => ({
          label: a.name,
          action: "exec",
          handler: "selectContaEditar",
          data: { accountId: a.id, accountName: a.name, accountType: a.type, accountBalance: a.balance },
        }));
        options.push({ label: "❌ Cancelar", action: "back" });
        return { title: "✏️ Qual conta editar?", options };
      } catch (e) {
        logger.error("[financialFlow] /contas/editar error:", e.message);
        await ctx.reply("❌ Erro ao carregar contas.");
        return {
          title: "Erro",
          options: [
            { label: "🔄 Tentar novamente", action: "goto", target: "/contas/editar" },
            { label: "↩️ Voltar", action: "back" },
          ],
        };
      }
    },
  },

  "/contas/editar/opcoes": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { editingAccountName, editingAccountType, editingAccountBalance } = ctx.state.context;
      const typeName = ACCOUNT_TYPES.find(t => t.key === editingAccountType)?.label || editingAccountType;
      const sign = (editingAccountBalance || 0) < 0 ? "🔴" : "🟢";
      return {
        title: `✏️ *${editingAccountName}* (${typeName})\n${sign} R$ ${formatMoney(editingAccountBalance)}`,
        options: [
          { label: "✏️ Renomear", action: "exec", handler: "editarNome" },
          { label: "🏦 Alterar tipo", action: "goto", target: "/contas/editar/tipo" },
          { label: "💰 Ajustar saldo", action: "exec", handler: "editarSaldo" },
          { label: "❌ Cancelar", action: "goto", target: "/contas" },
        ],
      };
    },
  },

  "/contas/editar/tipo": {
    title: "🏦 Novo tipo de conta?",
    options: [
      { label: "🏦 Conta corrente", action: "exec", handler: "setEditTipo", data: { type: "corrente" } },
      { label: "🐖 Poupança", action: "exec", handler: "setEditTipo", data: { type: "poupanca" } },
      { label: "👛 Carteira / Dinheiro", action: "exec", handler: "setEditTipo", data: { type: "carteira" } },
      { label: "📈 Investimento", action: "exec", handler: "setEditTipo", data: { type: "investimento" } },
      { label: "❌ Cancelar", action: "back" },
    ],
  },

  "/contas/editar/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { editingAccountName, pendingEditName, pendingEditType } = ctx.state.context;
      let title;
      if (pendingEditName) {
        title = `Renomear *${editingAccountName}* para *${pendingEditName}*?`;
      } else if (pendingEditType) {
        const typeName = ACCOUNT_TYPES.find(t => t.key === pendingEditType)?.label || pendingEditType;
        title = `Alterar tipo de *${editingAccountName}* para *${typeName}*?`;
      } else {
        title = `Confirmar edição de *${editingAccountName}*?`;
      }
      return {
        title,
        options: [
          { label: "✅ Confirmar", action: "exec", handler: "confirmarEdicaoConta" },
          { label: "❌ Cancelar", action: "back" },
        ],
      };
    },
  },

  "/contas/editar/saldo-ajuste": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { editingAccountName, editingAccountBalance, pendingEditBalance } = ctx.state.context;
      const current = editingAccountBalance || 0;
      const next = pendingEditBalance || 0;
      const diff = next - current;
      const diffLabel = diff >= 0 ? `+R$ ${formatMoney(diff)}` : `-R$ ${formatMoney(Math.abs(diff))}`;
      const entradaOuSaida = diff >= 0 ? "entrada" : "saída";
      return {
        title: `*${editingAccountName}*: R$ ${formatMoney(current)} → R$ ${formatMoney(next)} (${diffLabel})\n\nComo registrar essa diferença?`,
        options: [
          { label: "⚖️ Ajuste de saldo (sem categoria)", action: "exec", handler: "confirmarAjusteSaldo", data: { via: "adjustment" } },
          { label: `📝 Registrar como ${entradaOuSaida}`, action: "exec", handler: "confirmarAjusteSaldo", data: { via: "transaction" } },
          { label: "❌ Cancelar", action: "goto", target: "/contas" },
        ],
      };
    },
  },

  "/contas/tipo": {
    title: "🏦 Qual o tipo de conta?",
    options: [
      { label: "🏦 Conta corrente", action: "exec", handler: "setAccountType", data: { type: "corrente" } },
      { label: "🐖 Poupança", action: "exec", handler: "setAccountType", data: { type: "poupanca" } },
      { label: "👛 Carteira / Dinheiro", action: "exec", handler: "setAccountType", data: { type: "carteira" } },
      { label: "📈 Investimento", action: "exec", handler: "setAccountType", data: { type: "investimento" } },
      { label: "❌ Cancelar", action: "back" },
    ],
  },

  "/contas/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingAccountName, pendingAccountType, pendingAccountBalance } = ctx.state.context;
      const typeName = ACCOUNT_TYPES.find(t => t.key === pendingAccountType)?.label || pendingAccountType;
      return {
        title: `Criar *${pendingAccountName}* (${typeName}) com saldo R$ ${formatMoney(pendingAccountBalance || 0)}?`,
        options: [
          { label: "✅ Confirmar", action: "exec", handler: "confirmarConta" },
          { label: "❌ Cancelar", action: "exec", handler: "cancelarAddConta" },
        ],
      };
    },
  },

  // ── Categorias ────────────────────────────────────────────────────────────

  "/categorias": {
    dynamic: true,
    options: [],
    handler: async (ctx) => ({
      title: "🏷️ Categorias",
      options: [
        { label: "📋 Ver categorias", action: "exec", handler: "listarCategorias" },
        { label: "➕ Criar categoria", action: "exec", handler: "iniciarCriarCategoria" },
        { label: "↩️ Voltar", action: "back" },
      ],
    }),
  },

  "/categorias/tipo": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const name = ctx.state.context.pendingCategoryName || "Nova categoria";
      return {
        title: `*${name}* — Tipo:`,
        options: [
          { label: "📁 Categoria raiz", action: "goto", target: "/categorias/confirmar" },
          { label: "↳ Subcategoria de...", action: "goto", target: "/categorias/escolher-pai" },
          { label: "❌ Cancelar", action: "goto", target: "/categorias" },
        ],
      };
    },
  },

  "/categorias/escolher-pai": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      try {
        const res = await financialClient.listCategories(ctx.userId);
        const roots = (res?.categories || []).filter(c => !c.parentId);
        if (!roots.length) {
          await ctx.reply("❌ Nenhuma categoria raiz disponível. Crie primeiro uma categoria raiz.");
          return {
            title: "Sem categorias raiz",
            options: [
              { label: "↩️ Voltar", action: "back" },
              { label: "❌ Cancelar", action: "goto", target: "/categorias" },
            ],
          };
        }
        const options = roots.map(r => ({
          label: r.name,
          action: "exec",
          handler: "setParentCategory",
          data: { categoryId: r.id, categoryName: r.name },
        }));
        options.push({ label: "❌ Cancelar", action: "goto", target: "/categorias" });
        return { title: "Selecione a categoria pai:", options };
      } catch (e) {
        logger.error("[financialFlow] escolher-pai error:", e.message);
        await ctx.reply("❌ Erro ao carregar categorias.");
        return {
          title: "Erro",
          options: [
            { label: "↩️ Voltar", action: "back" },
            { label: "❌ Cancelar", action: "goto", target: "/categorias" },
          ],
        };
      }
    },
  },

  "/categorias/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingCategoryName, pendingCategoryParentName } = ctx.state.context;
      const subtitle = pendingCategoryParentName
        ? ` (subcategoria de *${pendingCategoryParentName}*)`
        : " (categoria raiz)";
      return {
        title: `Criar *${pendingCategoryName}*${subtitle}?`,
        options: [
          { label: "✅ Confirmar", action: "exec", handler: "confirmarCategoria" },
          { label: "❌ Cancelar", action: "back" },
        ],
      };
    },
  },

  // ── Orçamentos ────────────────────────────────────────────────────────────

  "/orcamentos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => ({
      title: "📊 Orçamentos",
      options: [
        { label: "📋 Ver orçamentos", action: "exec", handler: "listarOrcamentos" },
        { label: "➕ Criar orçamento", action: "exec", handler: "iniciarCriarOrcamento" },
        { label: "↩️ Voltar", action: "back" },
      ],
    }),
  },

  "/orcamentos/categoria": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const PAGE_SIZE = 8;
      const page = ctx.state.context.orcamentoCatPage || 0;

      try {
        const res = await financialClient.listCategories(ctx.userId);
        const roots = (res?.categories || []).filter(c => !c.parentId);

        const allItems = [
          { label: "💼 Total de despesas (geral)", categoryId: null, categoryName: null },
          ...roots.map(r => ({ label: r.name, categoryId: r.id, categoryName: r.name })),
        ];

        const totalPages = Math.ceil(allItems.length / PAGE_SIZE);
        const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
        const pageItems = allItems.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);
        const hasPrev = clampedPage > 0;
        const hasNext = clampedPage < totalPages - 1;

        const options = pageItems.map(item => ({
          label: item.label,
          action: "exec",
          handler: "setOrcamentoCategoria",
          data: { categoryId: item.categoryId, categoryName: item.categoryName },
        }));

        if (hasPrev) options.push({ label: "⬅️ Anterior", action: "exec", handler: "orcamentoCatPagePrev" });
        if (hasNext) options.push({ label: "➡️ Próxima →", action: "exec", handler: "orcamentoCatPageNext" });
        options.push({ label: "❌ Cancelar", action: "back" });

        const pageLabel = totalPages > 1 ? ` (${clampedPage + 1}/${totalPages})` : "";
        return { title: `Para qual categoria?${pageLabel}`, options };
      } catch (e) {
        logger.error("[financialFlow] orcamentos/categoria error:", e.message);
        await ctx.reply("❌ Erro ao carregar categorias.");
        return {
          title: "Erro",
          options: [
            { label: "🔄 Tentar novamente", action: "exec", handler: "orcamentoCatReload" },
            { label: "↩️ Voltar", action: "back" },
          ],
        };
      }
    },
  },

  "/orcamentos/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingBudgetLimit, pendingBudgetCategoryName } = ctx.state.context;
      const catLabel = pendingBudgetCategoryName || "total de despesas";
      return {
        title: `Criar orçamento de R$ ${formatMoney(pendingBudgetLimit || 0)} / mês para *${catLabel}*?`,
        options: [
          { label: "✅ Confirmar", action: "exec", handler: "confirmarOrcamento" },
          { label: "❌ Cancelar", action: "back" },
        ],
      };
    },
  },

  // ── NLP: confirmação de transação via texto livre ─────────────────────────

  "/nlp-confirm": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const tx = ctx.state.context.pendingNlpTransaction;
      if (!tx) {
        return {
          title: "💰 Assistente Financeiro",
          options: [
            { label: "↩️ Ir ao menu", action: "goto", target: "/" },
            { label: "✖️ Fechar", action: "exec", handler: "close" },
          ],
        };
      }
      const typeLabel = tx.type === "income" ? "receita 🟢" : "despesa 🔴";
      const dateLabel = formatDate(new Date(tx.date));
      const desc = tx.description ? ` — *${tx.description}*` : "";
      const pendingNote = tx.isPending ? " _(pendente)_" : "";
      return {
        title: `Registrar R$ ${formatMoney(tx.amount)}${desc} como ${typeLabel} em *${tx.accountName}* (${dateLabel})${pendingNote}?`,
        options: [
          { label: "✅ Sim, registrar", action: "exec", handler: "confirmarNlp" },
          { label: "❌ Cancelar", action: "exec", handler: "cancelarNlp" },
        ],
      };
    },
  },

  // ── Configurações ─────────────────────────────────────────────────────────

  "/config": {
    dynamic: true,
    options: [],
    handler: async (ctx) => ({
      title: "⚙️ Configurações",
      options: [
        { label: "🔔 Horário de notificações", action: "exec", handler: "configNotifHour" },
        { label: "↩️ Voltar", action: "back" },
      ],
    }),
  },

  // ── Dúvidas ───────────────────────────────────────────────────────────────

  "/duvidas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await ctx.reply(
        "❓ *Dúvidas — Assistente Financeiro*\n\n" +
        "*Como registrar uma transação?*\n" +
        "Envie frases naturais como:\n" +
        "• \"Gastei 50 reais de uber\"\n" +
        "• \"Recebi 3200 de salário\"\n" +
        "• \"Paguei 120 de mercado ontem\"\n\n" +
        "*Como ver meu saldo?*\n" +
        "Use o menu 🏦 Contas.\n\n" +
        "*Os dados são seguros?*\n" +
        "Sim. Tudo é criptografado com sua chave pessoal. Nem o desenvolvedor tem acesso.\n\n" +
        "Para mais ajuda, entre em contato com o suporte."
      );
      return {
        title: "Continuar?",
        options: [
          { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
          { label: "✖️ Fechar", action: "exec", handler: "close" },
        ],
      };
    },
  },

  // ── Handlers ──────────────────────────────────────────────────────────────

  handlers: {

    close: async (ctx) => {
      await ctx.reply("💰 Assistente financeiro fechado. Até logo!");
      return { end: true };
    },

    startOAuth: async (ctx) => {
      try {
        const result = await financialClient.startAuth(ctx.userId);
        if (!result || !result.authUrl) {
          await ctx.reply("❌ Não foi possível gerar o link. Tente novamente.");
          return { noRender: true };
        }
        await ctx.reply(
          "🔐 *Autenticação Google*\n\n" +
          "Clique no link abaixo para conectar sua conta:\n\n" +
          result.authUrl + "\n\n" +
          "⏱️ O link expira em *15 minutos*.\n" +
          "Após autorizar, você receberá uma confirmação aqui."
        );
        pollAuthStatus(ctx.client, ctx.chatId, ctx.userId);
        return { end: true };
      } catch (e) {
        logger.error("[financialFlow] startOAuth error:", e.message);
        await ctx.reply("❌ Erro ao gerar link. Tente novamente.");
        return { noRender: true };
      }
    },

    // ── Contas ──────────────────────────────────────────────────────────────

    listarContas: async (ctx) => {
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        if (!res?.accounts?.length) {
          await ctx.reply("🏦 Você ainda não tem contas cadastradas.\n\nUse *Adicionar conta* para criar uma.");
          return { noRender: true };
        }
        const total = res.accounts.reduce((s, a) => s + (a.balance || 0), 0);
        const lines = res.accounts.map(a => {
          const type = ACCOUNT_TYPES.find(t => t.key === a.type)?.label || a.type;
          const sign = a.balance < 0 ? "🔴" : "🟢";
          return `${sign} *${a.name}* (${type}): R$ ${formatMoney(a.balance)}`;
        });
        await ctx.reply(
          `🏦 *Suas contas:*\n\n${lines.join("\n")}\n\n` +
          `💰 *Total: R$ ${formatMoney(total)}*`
        );
      } catch (e) {
        logger.error("[financialFlow] listarContas error:", e.message);
        await ctx.reply("❌ Erro ao carregar contas. Tente novamente.");
      }
      return { noRender: true };
    },

    setAccountType: async (ctx, data) => {
      ctx.state.context.pendingAccountType = data.type;
      ctx.state.context.pendingAccountName = null;
      ctx.state.context.pendingAccountBalance = null;
      ctx.state.context.awaitingAccountName = true;
      await ctx.reply("✏️ Digite o *nome* da conta (ex: Nubank, C6 Bank, Carteira):");
      return { noRender: true };
    },

    confirmarConta: async (ctx) => {
      const { pendingAccountType, pendingAccountName, pendingAccountBalance } = ctx.state.context;
      try {
        const result = await financialClient.createAccount(ctx.userId, {
          name: pendingAccountName,
          type: pendingAccountType,
          balance: pendingAccountBalance || 0,
        });
        const typeName = ACCOUNT_TYPES.find(t => t.key === pendingAccountType)?.label || pendingAccountType;
        await ctx.reply(
          `✅ *Conta criada!*\n\n🏦 ${pendingAccountName} (${typeName})\n` +
          `💰 Saldo inicial: R$ ${formatMoney(result.balance || 0)}`
        );
        ctx.state.context.pendingAccountType = null;
        ctx.state.context.pendingAccountName = null;
        ctx.state.context.pendingAccountBalance = null;
        ctx.state.path = "/contas";
      } catch (e) {
        logger.error("[financialFlow] confirmarConta error:", e.message);
        await ctx.reply("❌ Erro ao criar conta. Tente novamente.");
        return { noRender: true };
      }
    },

    cancelarAddConta: async (ctx) => {
      ctx.state.context.pendingAccountType = null;
      ctx.state.context.pendingAccountName = null;
      ctx.state.context.pendingAccountBalance = null;
      ctx.state.path = "/contas";
    },

    // ── Editar conta ─────────────────────────────────────────────────────────

    selectContaEditar: async (ctx, data) => {
      ctx.state.context.editingAccountId = data.accountId;
      ctx.state.context.editingAccountName = data.accountName;
      ctx.state.context.editingAccountType = data.accountType;
      ctx.state.context.editingAccountBalance = data.accountBalance;
      ctx.state.context.pendingEditName = null;
      ctx.state.context.pendingEditType = null;
      ctx.state.context.pendingEditBalance = null;
      ctx.state.path = "/contas/editar/opcoes";
    },

    editarNome: async (ctx) => {
      ctx.state.context.pendingEditName = null;
      ctx.state.context.awaitingEditName = true;
      await ctx.reply(`✏️ Digite o *novo nome* para *${ctx.state.context.editingAccountName}*:`);
      return { noRender: true };
    },

    editarSaldo: async (ctx) => {
      ctx.state.context.pendingEditBalance = null;
      ctx.state.context.awaitingEditBalance = true;
      await ctx.reply(
        `💰 Saldo atual de *${ctx.state.context.editingAccountName}*: R$ ${formatMoney(ctx.state.context.editingAccountBalance)}\n\n` +
        `Digite o *novo saldo* em R$:`
      );
      return { noRender: true };
    },

    setEditTipo: async (ctx, data) => {
      ctx.state.context.pendingEditType = data.type;
      ctx.state.context.pendingEditName = null;
      ctx.state.path = "/contas/editar/confirmar";
    },

    confirmarEdicaoConta: async (ctx) => {
      const { editingAccountId, editingAccountName, pendingEditName, pendingEditType } = ctx.state.context;
      try {
        const fields = {};
        if (pendingEditName) fields.name = pendingEditName;
        if (pendingEditType) fields.type = pendingEditType;
        await financialClient.updateAccount(ctx.userId, editingAccountId, fields);
        const label = pendingEditName
          ? `Conta renomeada para *${pendingEditName}*!`
          : `Tipo de *${editingAccountName}* alterado!`;
        await ctx.reply(`✅ ${label}`);
        ctx.state.context.editingAccountId = null;
        ctx.state.context.editingAccountName = null;
        ctx.state.context.editingAccountType = null;
        ctx.state.context.editingAccountBalance = null;
        ctx.state.context.pendingEditName = null;
        ctx.state.context.pendingEditType = null;
        ctx.state.path = "/contas";
      } catch (e) {
        logger.error("[financialFlow] confirmarEdicaoConta error:", e.message);
        await ctx.reply("❌ Erro ao editar conta. Tente novamente.");
        return { noRender: true };
      }
    },

    confirmarAjusteSaldo: async (ctx, data) => {
      const { editingAccountId, editingAccountName, editingAccountBalance, pendingEditBalance } = ctx.state.context;
      const diff = (pendingEditBalance || 0) - (editingAccountBalance || 0);
      try {
        const type = data.via === "adjustment"
          ? "balance_adjustment"
          : diff >= 0 ? "income" : "expense";
        await financialClient.createTransaction(ctx.userId, {
          accountId: editingAccountId,
          amount: Math.abs(diff),
          description: "Ajuste de saldo",
          type,
          date: new Date().toISOString(),
          status: "confirmed",
        });
        await ctx.reply(
          `✅ Saldo de *${editingAccountName}* atualizado!\n\n` +
          `R$ ${formatMoney(editingAccountBalance)} → R$ ${formatMoney(pendingEditBalance)}`
        );
        ctx.state.context.editingAccountId = null;
        ctx.state.context.editingAccountName = null;
        ctx.state.context.editingAccountType = null;
        ctx.state.context.editingAccountBalance = null;
        ctx.state.context.pendingEditBalance = null;
        ctx.state.path = "/contas";
      } catch (e) {
        logger.error("[financialFlow] confirmarAjusteSaldo error:", e.message);
        await ctx.reply("❌ Erro ao ajustar saldo. Tente novamente.");
        return { noRender: true };
      }
    },

    // ── Extrato ─────────────────────────────────────────────────────────────

    extratoMes: async (ctx, data) => {
      ctx.state.context.extratoPeriod = data?.period || "current";
      ctx.state.context.extratoPage = 0;
      ctx.state.path = "/extrato/ver";
    },

    extratoPageNext: async (ctx) => {
      ctx.state.context.extratoPage = (ctx.state.context.extratoPage || 0) + 1;
      return { rerenderCurrent: true };
    },

    extratoPagePrev: async (ctx) => {
      ctx.state.context.extratoPage = Math.max(0, (ctx.state.context.extratoPage || 0) - 1);
      return { rerenderCurrent: true };
    },

    extratoReload: async (ctx) => {
      return { rerenderCurrent: true };
    },

    // ── Categorias ──────────────────────────────────────────────────────────

    listarCategorias: async (ctx) => {
      try {
        const res = await financialClient.listCategories(ctx.userId);
        if (!res?.categories?.length) {
          await ctx.reply("🏷️ Nenhuma categoria encontrada.");
          return { noRender: true };
        }
        const lines = ["🏷️ *Categorias:*\n"];
        for (const cat of res.categories) {
          lines.push(`• *${cat.name}*`);
          for (const sub of (cat.children || [])) {
            lines.push(`  ↳ ${sub.name}`);
          }
        }
        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[financialFlow] listarCategorias error:", e.message);
        await ctx.reply("❌ Erro ao carregar categorias.");
      }
      return { noRender: true };
    },

    iniciarCriarCategoria: async (ctx) => {
      ctx.state.context.pendingCategoryName = null;
      ctx.state.context.awaitingCategoryName = true;
      await ctx.reply("✏️ Digite o *nome* da nova categoria:");
      return { noRender: true };
    },

    setParentCategory: async (ctx, data) => {
      ctx.state.context.pendingCategoryParentId = data.categoryId;
      ctx.state.context.pendingCategoryParentName = data.categoryName;
      ctx.state.path = "/categorias/confirmar";
    },

    confirmarCategoria: async (ctx) => {
      const { pendingCategoryName, pendingCategoryParentId, pendingCategoryParentName } = ctx.state.context;
      try {
        await financialClient.createCategory(ctx.userId, {
          name: pendingCategoryName,
          parentId: pendingCategoryParentId || undefined,
        });
        const label = pendingCategoryParentName
          ? `Subcategoria *${pendingCategoryName}* (em *${pendingCategoryParentName}*) criada!`
          : `Categoria *${pendingCategoryName}* criada!`;
        await ctx.reply(`✅ ${label}`);
        ctx.state.context.pendingCategoryName = null;
        ctx.state.context.pendingCategoryParentId = null;
        ctx.state.context.pendingCategoryParentName = null;
        ctx.state.path = "/categorias";
      } catch (e) {
        logger.error("[financialFlow] confirmarCategoria error:", e.message);
        await ctx.reply("❌ Erro ao criar categoria. Tente novamente.");
      }
      return { noRender: true };
    },

    // ── Orçamentos ──────────────────────────────────────────────────────────

    listarOrcamentos: async (ctx) => {
      try {
        const res = await financialClient.listBudgets(ctx.userId);
        if (!res?.budgets?.length) {
          await ctx.reply(
            "📊 Nenhum orçamento configurado.\n\nUse *Criar orçamento* para definir limites de gastos mensais."
          );
          return { noRender: true };
        }
        const lines = ["📊 *Orçamentos — Mês atual:*\n"];
        for (const b of res.budgets) {
          const pct = Math.min(b.pct, 999);
          const bar = progressBar(pct);
          const catName = b.categoryName || "Total de despesas";
          const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
          lines.push(
            `${emoji} *${catName}*\n` +
            `   ${bar} ${pct}%\n` +
            `   R$ ${formatMoney(b.spent)} / R$ ${formatMoney(b.limit)}\n`
          );
        }
        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[financialFlow] listarOrcamentos error:", e.message);
        await ctx.reply("❌ Erro ao carregar orçamentos.");
      }
      return { noRender: true };
    },

    iniciarCriarOrcamento: async (ctx) => {
      ctx.state.context.pendingBudgetLimit = null;
      ctx.state.context.pendingBudgetCategoryId = null;
      ctx.state.context.pendingBudgetCategoryName = null;
      ctx.state.context.orcamentoCatPage = 0;
      ctx.state.path = "/orcamentos/categoria";
    },

    setOrcamentoCategoria: async (ctx, data) => {
      ctx.state.context.pendingBudgetCategoryId = data.categoryId || null;
      ctx.state.context.pendingBudgetCategoryName = data.categoryName || null;
      ctx.state.context.orcamentoCatPage = 0;
      ctx.state.context.awaitingBudgetLimit = true;
      const catLabel = data.categoryName || "total de despesas";
      await ctx.reply(`✏️ Orçamento para *${catLabel}*.\n\nDigite o *limite mensal* em R$ (ex: 1500 ou 1.500,00):`);
      return { noRender: true };
    },

    orcamentoCatPageNext: async (ctx) => {
      ctx.state.context.orcamentoCatPage = (ctx.state.context.orcamentoCatPage || 0) + 1;
      return { rerenderCurrent: true };
    },

    orcamentoCatPagePrev: async (ctx) => {
      ctx.state.context.orcamentoCatPage = Math.max(0, (ctx.state.context.orcamentoCatPage || 0) - 1);
      return { rerenderCurrent: true };
    },

    orcamentoCatReload: async (ctx) => {
      return { rerenderCurrent: true };
    },

    confirmarOrcamento: async (ctx) => {
      const { pendingBudgetLimit, pendingBudgetCategoryId, pendingBudgetCategoryName } = ctx.state.context;
      try {
        await financialClient.createBudget(ctx.userId, {
          categoryId: pendingBudgetCategoryId || undefined,
          limit: pendingBudgetLimit,
          period: "monthly",
        });
        const catLabel = pendingBudgetCategoryName || "total de despesas";
        await ctx.reply(`✅ Orçamento de R$ ${formatMoney(pendingBudgetLimit)} / mês para *${catLabel}* criado!`);
        ctx.state.context.pendingBudgetLimit = null;
        ctx.state.context.pendingBudgetCategoryId = null;
        ctx.state.context.pendingBudgetCategoryName = null;
        ctx.state.path = "/orcamentos";
      } catch (e) {
        logger.error("[financialFlow] confirmarOrcamento error:", e.message);
        await ctx.reply("❌ Erro ao criar orçamento. Tente novamente.");
      }
      return { noRender: true };
    },

    // ── NLP ───────────────────────────────────────────────────────────────────

    confirmarNlp: async (ctx) => {
      const tx = ctx.state.context.pendingNlpTransaction;
      if (!tx) return { end: true };
      try {
        const result = await financialClient.createTransaction(ctx.userId, {
          accountId: tx.accountId,
          amount: tx.amount,
          description: tx.description,
          type: tx.type,
          date: tx.date,
          status: tx.isPending ? "pending" : "confirmed",
        });
        const typeLabel = tx.type === "income" ? "Receita" : "Despesa";
        const sign = tx.type === "income" ? "+" : "-";
        const balanceText = result.newBalance !== undefined
          ? `\n\nSaldo *${tx.accountName}*: R$ ${formatMoney(result.newBalance)}`
          : "";
        await ctx.reply(
          `✅ *${typeLabel} registrada!*\n\n` +
          `${sign}R$ ${formatMoney(tx.amount)}` +
          (tx.description ? ` — ${tx.description}` : "") +
          balanceText
        );
        ctx.state.context.pendingNlpTransaction = null;
      } catch (e) {
        logger.error("[financialFlow] confirmarNlp error:", e.message);
        await ctx.reply("❌ Erro ao registrar. Tente novamente com */financeiro*.");
      }
      return { end: true };
    },

    cancelarNlp: async (ctx) => {
      ctx.state.context.pendingNlpTransaction = null;
      await ctx.reply("❌ Transação cancelada.");
      return { end: true };
    },

    // ── Config ───────────────────────────────────────────────────────────────

    configNotifHour: async (ctx) => {
      await ctx.reply("⚙️ Configuração de notificações disponível em breve!");
      return { noRender: true };
    },
  },
});

module.exports = financialFlow;
module.exports.parseAmount = parseAmount;
