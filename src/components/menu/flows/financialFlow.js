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
    handler: async (ctx) => ({
      title: "📋 Extrato — período",
      options: [
        { label: "📅 Este mês", action: "exec", handler: "extratoMes", data: { period: "current" } },
        { label: "📅 Mês anterior", action: "exec", handler: "extratoMes", data: { period: "last" } },
        { label: "↩️ Voltar", action: "back" },
      ],
    }),
  },

  // ── Contas ────────────────────────────────────────────────────────────────

  "/contas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => ({
      title: "🏦 Contas bancárias",
      options: [
        { label: "📋 Ver contas", action: "exec", handler: "listarContas" },
        { label: "➕ Adicionar conta", action: "goto", target: "/contas/tipo" },
        { label: "↩️ Voltar", action: "back" },
      ],
    }),
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

  "/categorias/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingCategoryName } = ctx.state.context;
      return {
        title: `Criar categoria *${pendingCategoryName}*?`,
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

  "/orcamentos/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingBudgetLimit } = ctx.state.context;
      return {
        title: `Criar orçamento mensal de R$ ${formatMoney(pendingBudgetLimit || 0)} para todas as despesas?`,
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
      }
      return { noRender: true };
    },

    cancelarAddConta: async (ctx) => {
      ctx.state.context.pendingAccountType = null;
      ctx.state.context.pendingAccountName = null;
      ctx.state.context.pendingAccountBalance = null;
      ctx.state.path = "/contas";
    },

    // ── Extrato ─────────────────────────────────────────────────────────────

    extratoMes: async (ctx, data) => {
      const period = data?.period || "current";
      try {
        const res = await financialClient.listTransactions(ctx.userId, { period });
        const periodLabel = period === "last" ? "Mês passado" : "Este mês";

        if (!res?.transactions?.length) {
          await ctx.reply(`📋 Nenhuma transação em *${periodLabel.toLowerCase()}*.`);
          return { noRender: true };
        }

        const { transactions, summary } = res;
        const lines = [
          `📋 *Extrato — ${periodLabel}*\n`,
          `🟢 Entradas: R$ ${formatMoney(summary.income)}`,
          `🔴 Saídas:   R$ ${formatMoney(summary.expense)}`,
          `💰 Saldo:    R$ ${formatMoney(summary.net)}\n`,
        ];

        for (const t of transactions.slice(0, 15)) {
          const emoji = t.type === "income" ? "🟢" : "🔴";
          const sign = t.type === "income" ? "+" : "-";
          const desc = t.description || (t.type === "income" ? "Receita" : "Despesa");
          lines.push(`${emoji} ${formatDate(t.date)}  ${sign}R$ ${formatMoney(t.amount)}  ${desc}`);
        }
        if (transactions.length > 15) {
          lines.push(`\n_... e mais ${transactions.length - 15} transações_`);
        }

        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[financialFlow] extratoMes error:", e.message);
        await ctx.reply("❌ Erro ao carregar extrato. Tente novamente.");
      }
      return { noRender: true };
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

    confirmarCategoria: async (ctx) => {
      const { pendingCategoryName } = ctx.state.context;
      try {
        await financialClient.createCategory(ctx.userId, { name: pendingCategoryName });
        await ctx.reply(`✅ Categoria *${pendingCategoryName}* criada com sucesso!`);
        ctx.state.context.pendingCategoryName = null;
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
      ctx.state.context.awaitingBudgetLimit = true;
      await ctx.reply("✏️ Digite o *limite mensal* em R$ (ex: 1500 ou 1.500,00):");
      return { noRender: true };
    },

    confirmarOrcamento: async (ctx) => {
      const { pendingBudgetLimit } = ctx.state.context;
      try {
        await financialClient.createBudget(ctx.userId, { limit: pendingBudgetLimit, period: "monthly" });
        await ctx.reply(`✅ Orçamento de R$ ${formatMoney(pendingBudgetLimit)} / mês criado!`);
        ctx.state.context.pendingBudgetLimit = null;
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
