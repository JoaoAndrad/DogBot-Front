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

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

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

// ─── Budget Alert Helper ──────────────────────────────────────────────────────

async function handleBudgetAlerts(ctx, result) {
  const alerts = result?.budgetAlerts || [];
  for (const a of alerts) {
    const catLabel = a.categoryId ? `categoria *${a.categoryName || "—"}*` : "orçamento geral";
    if (a.level === "100") {
      await ctx.reply(`🚨 Você ultrapassou o ${catLabel}! Gasto: R$ ${formatMoney(a.spent)} / Limite: R$ ${formatMoney(a.limit)}`);
    } else {
      await ctx.reply(`⚠️ Você usou 80% do ${catLabel}. Gasto: R$ ${formatMoney(a.spent)} / Limite: R$ ${formatMoney(a.limit)}`);
    }
  }
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
          { label: "💳 Cartões", action: "goto", target: "/cartoes" },
          { label: "📅 Lançamentos futuros", action: "goto", target: "/agendamentos" },
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
      const now = new Date();
      const nextMonth = (now.getMonth() + 1) % 12;
      const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();

      let hasTxs = false;
      let hasNextMonthTxs = false;
      try {
        const [txsRes, schedRes] = await Promise.all([
          financialClient.listTransactions(ctx.userId, { period: "all", limit: 1 }),
          financialClient.listScheduled(ctx.userId).catch(() => null),
        ]);
        hasTxs = !!(txsRes?.transactions?.length);
        hasNextMonthTxs = (schedRes?.transactions || []).some(t => {
          const d = new Date(t.date);
          return d.getMonth() === nextMonth && d.getFullYear() === nextYear;
        });
      } catch (e) {
        logger.warn("[financialFlow] /extrato check error:", e.message);
      }
      if (!hasTxs) {
        await ctx.reply("📋 Você ainda não tem nenhuma transação registrada.");
        return {
          title: "O que deseja fazer?",
          options: [
            { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
            { label: "✖️ Fechar", action: "exec", handler: "close" },
          ],
        };
      }
      const thisMonthName = MONTHS_PT[now.getMonth()];
      const lastMonthName = MONTHS_PT[(now.getMonth() + 11) % 12];
      const nextMonthName = MONTHS_PT[nextMonth];
      const options = [];
      if (hasNextMonthTxs) {
        options.push({ label: `📅 Lançamentos futuros (${nextMonthName})`, action: "exec", handler: "extratoMes", data: { period: "next" } });
      }
      options.push(
        { label: `📅 Este mês (${thisMonthName})`, action: "exec", handler: "extratoMes", data: { period: "current" } },
        { label: `📅 Mês anterior (${lastMonthName})`, action: "exec", handler: "extratoMes", data: { period: "last" } },
        { label: "↩️ Voltar", action: "back" },
      );
      return { title: "📋 Extrato — período", options };
    },
  },

  "/extrato/ver": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { extratoPeriod = "current", extratoPage = 0 } = ctx.state.context;
      const limit = 10;
      const skip = extratoPage * limit;

      const now = new Date();
      const monthIdx = extratoPeriod === "last"
        ? (now.getMonth() + 11) % 12
        : extratoPeriod === "next"
        ? (now.getMonth() + 1) % 12
        : now.getMonth();
      const monthName = MONTHS_PT[monthIdx];

      function buildGroupedLines(txs, headerLine, summaryLine) {
        const byDate = new Map();
        for (const t of txs) {
          const key = formatDate(new Date(t.date));
          if (!byDate.has(key)) byDate.set(key, []);
          byDate.get(key).push(t);
        }
        const lines = [headerLine, ""];
        if (summaryLine) lines.push(summaryLine, "");
        for (const [date, group] of byDate) {
          lines.push(`*${date}*`);
          for (const t of group) {
            const sign = t.type === "income" ? "+" : "-";
            const desc = t.description || (t.type === "income" ? "Receita" : "Despesa");
            const cat = t.categoryName ? `  [${t.categoryName}]` : "";
            const recNote = t.recurrence ? " 🔁" : "";
            lines.push(`  ${sign}R$ ${formatMoney(t.amount)}  ${desc}${cat}${recNote}`);
          }
          lines.push("");
        }
        return lines.join("\n").trimEnd();
      }

      try {
        // ── Lançamentos futuros (próximo mês) ───────────────────────────────
        if (extratoPeriod === "next") {
          const nextMonth = (now.getMonth() + 1) % 12;
          const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
          const schedRes = await financialClient.listScheduled(ctx.userId);
          const txs = (schedRes?.transactions || [])
            .filter(t => {
              const d = new Date(t.date);
              return d.getMonth() === nextMonth && d.getFullYear() === nextYear;
            })
            .sort((a, b) => new Date(a.date) - new Date(b.date));

          if (!txs.length) {
            await ctx.reply(`📋 Nenhum lançamento previsto para *${monthName}*.`);
            return {
              title: "Sem lançamentos",
              options: [
                { label: "🔄 Trocar período", action: "goto", target: "/extrato" },
                { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
              ],
            };
          }

          const totalIncome = txs.filter(t => t.type === "income").reduce((s, t) => s + (t.amount || 0), 0);
          const totalExpense = txs.filter(t => t.type !== "income").reduce((s, t) => s + (t.amount || 0), 0);
          const summaryLine = `🟢 +R$ ${formatMoney(totalIncome)}  ·  🔴 -R$ ${formatMoney(totalExpense)}  ·  💰 R$ ${formatMoney(totalIncome - totalExpense)}`;
          await ctx.reply(buildGroupedLines(txs, `📅 *Lançamentos futuros — ${monthName}*`, summaryLine));

          ctx.state.context.extratoTransacoes = txs.map(t => ({
            id: t.id, amount: t.amount, description: t.description, type: t.type,
            date: t.date, recurrence: t.recurrence || null,
            installmentGroupId: null, installmentNumber: null, installmentTotal: null,
          }));
          return {
            title: `Lançamentos — ${monthName}`,
            options: [
              { label: "🔄 Trocar período", action: "goto", target: "/extrato" },
              { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
            ],
          };
        }

        // ── Este mês / Mês anterior ─────────────────────────────────────────
        const res = await financialClient.listTransactions(ctx.userId, {
          period: extratoPeriod,
          limit: limit + 1,
          skip,
        });

        if (!res?.transactions?.length) {
          await ctx.reply(`📋 Nenhuma transação em *${monthName.toLowerCase()}*.`);
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

        const pageSuffix = hasNext || hasPrev ? ` (pág. ${extratoPage + 1})` : "";
        let summaryLine = null;
        if (extratoPage === 0 && summary) {
          const net = summary.net ?? (summary.income - summary.expense);
          summaryLine = `🟢 +R$ ${formatMoney(summary.income)}  ·  🔴 -R$ ${formatMoney(summary.expense)}  ·  💰 R$ ${formatMoney(net)}`;
        }
        await ctx.reply(buildGroupedLines(txs, `📋 *Extrato — ${monthName}*${pageSuffix}`, summaryLine));

        ctx.state.context.extratoTransacoes = txs.map(t => ({
          id: t.id, amount: t.amount, description: t.description, type: t.type,
          date: t.date, recurrence: t.recurrence || null,
          installmentGroupId: t.installmentGroupId || null,
          installmentNumber: t.installmentNumber || null, installmentTotal: t.installmentTotal || null,
        }));

        const options = [];
        if (hasPrev) options.push({ label: "⬅️ Página anterior", action: "exec", handler: "extratoPagePrev" });
        if (hasNext) options.push({ label: "➡️ Próxima página", action: "exec", handler: "extratoPageNext" });
        options.push({ label: "✏️ Editar lançamento", action: "exec", handler: "iniciarEditarLancamento" });
        options.push({ label: "🔄 Trocar período", action: "goto", target: "/extrato" });
        options.push({ label: "↩️ Voltar ao menu", action: "goto", target: "/" });
        return { title: `Extrato — ${monthName} · pág. ${extratoPage + 1}`, options };
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
      if (hasAccounts) options.push({ label: "🔄 Transferir saldo entre contas", action: "goto", target: "/transferencia" });
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
          data: { accountId: a.id, accountName: a.name, accountType: a.type, accountBalance: a.balance, accountIsDefault: a.isDefault },
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
      const { editingAccountName, editingAccountType, editingAccountBalance, editingAccountIsDefault } = ctx.state.context;
      const typeName = ACCOUNT_TYPES.find(t => t.key === editingAccountType)?.label || editingAccountType;
      const sign = (editingAccountBalance || 0) < 0 ? "🔴" : "🟢";
      const options = [
        { label: "✏️ Renomear", action: "exec", handler: "editarNome" },
        { label: "🏦 Alterar tipo", action: "goto", target: "/contas/editar/tipo" },
        { label: "💰 Ajustar saldo", action: "exec", handler: "editarSaldo" },
      ];
      if (!editingAccountIsDefault) {
        options.push({ label: "⭐ Definir como padrão", action: "exec", handler: "definirContaPadrao" });
      }
      options.push({ label: "❌ Cancelar", action: "goto", target: "/contas" });
      return {
        title: `✏️ *${editingAccountName}* (${typeName})\n${sign} R$ ${formatMoney(editingAccountBalance)}`,
        options,
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
      const installNote = tx.installmentCount
        ? ` em *${tx.installmentCount}x* de R$ ${formatMoney(tx.amount / tx.installmentCount)}`
        : "";
      let recurrenceNote = "";
      if (tx.recurrence === "monthly") {
        recurrenceNote = tx.recurrenceDay
          ? `\n🔁 Recorrente mensalmente (dia ${tx.recurrenceDay})`
          : "\n🔁 Recorrente mensalmente";
      } else if (tx.recurrence === "weekly") {
        recurrenceNote = "\n🔁 Recorrente semanalmente";
      }
      const catDisplayName = tx.suggestedCategoryName
        ? (tx.suggestedCategoryParentName
            ? `${tx.suggestedCategoryParentName} › ${tx.suggestedCategoryName}`
            : tx.suggestedCategoryName)
        : null;
      const catNote = catDisplayName ? `\n🏷️ Categoria sugerida: *${catDisplayName}*` : "";
      const catLabel = catDisplayName ? `*${catDisplayName}*` : "_nenhuma_";
      return {
        title: `Registrar R$ ${formatMoney(tx.amount)}${installNote}${desc} como ${typeLabel} em *${tx.accountName}* (${dateLabel})${pendingNote}?${recurrenceNote}\n🏷️ Categoria: ${catLabel}`,
        options: [
          { label: "✅ Sim, registrar", action: "exec", handler: "confirmarNlp" },
          { label: "🏷️ Editar categoria", action: "goto", target: "/nlp-confirm/categoria" },
          { label: "❌ Cancelar", action: "exec", handler: "cancelarNlp" },
        ],
      };
    },
  },

  "/nlp-confirm/categoria": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let parents = [];
      try {
        const res = await financialClient.listCategories(ctx.userId);
        parents = res?.categories || [];
      } catch (e) {
        logger.warn("[financialFlow] /nlp-confirm/categoria error:", e.message);
      }
      // WhatsApp max 12 options; reserve 2 for "Nova" + "Voltar"
      const shown = parents.slice(0, 10);
      const options = shown.map(c => {
        const hasChildren = !!(c.children && c.children.length);
        return {
          label: hasChildren ? `${c.name} ›` : c.name,
          action: "exec",
          handler: hasChildren ? "nlpSelecionarCategoriaPai" : "setCategoriaNlp",
          data: { categoryId: c.id, categoryName: c.name },
        };
      });
      options.push({ label: "➕ Nova categoria", action: "exec", handler: "nlpNovaCategoriaInput" });
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: "🏷️ Escolha a categoria:", options };
    },
  },

  "/nlp-confirm/categoria/subs": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const parentId = ctx.state.context.nlpSelectedParentCat?.id;
      const parentName = ctx.state.context.nlpSelectedParentCat?.name;
      if (!parentId) {
        return { title: "❌ Categoria não encontrada", options: [{ label: "↩️ Voltar", action: "back" }, { label: "❌ Cancelar", action: "exec", handler: "cancelarNlp" }] };
      }
      let subs = [];
      try {
        const res = await financialClient.listCategories(ctx.userId);
        const parent = (res?.categories || []).find(c => c.id === parentId);
        subs = parent?.children || [];
      } catch (e) {
        logger.warn("[financialFlow] /nlp-confirm/categoria/subs error:", e.message);
      }
      const shown = subs.slice(0, 10);
      const options = shown.map(s => ({
        label: s.name,
        action: "exec",
        handler: "setCategoriaNlp",
        data: { categoryId: s.id, categoryName: s.name, parentName },
      }));
      options.push({ label: "➕ Nova subcategoria", action: "exec", handler: "nlpNovaSubcategoriaInput" });
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: `🏷️ Subcategorias de *${parentName}*:`, options };
    },
  },

  // ── Agendamentos ──────────────────────────────────────────────────────────

  "/agendamentos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      try {
        const res = await financialClient.listScheduled(ctx.userId);
        const txs = res?.transactions || [];
        const options = [];
        for (const t of txs) {
          const emoji = t.type === "income" ? "🟢" : "🔴";
          const sign = t.type === "income" ? "+" : "-";
          const desc = t.description || (t.type === "income" ? "Receita" : "Despesa");
          const dateLabel = formatDate(new Date(t.date));
          const recLabel = t.recurrence ? " 🔁" : "";
          options.push({
            label: `${emoji} ${sign}R$ ${formatMoney(t.amount)} ${desc} — ${dateLabel}${recLabel}`,
            action: "exec",
            handler: "verAgendamento",
            data: { transactionId: t.id },
          });
        }
        options.push({ label: "➕ Novo agendamento", action: "exec", handler: "iniciarNovoAgendamento" });
        options.push({ label: "↩️ Voltar", action: "back" });
        return { title: txs.length ? "📅 Agendamentos pendentes" : "📅 Agendamentos\n\nNenhum pendente ainda.", options };
      } catch (e) {
        logger.error("[financialFlow] /agendamentos error:", e.message);
        await ctx.reply("❌ Erro ao carregar agendamentos.");
        return {
          title: "Erro",
          options: [
            { label: "🔄 Tentar novamente", action: "goto", target: "/agendamentos" },
            { label: "↩️ Voltar", action: "back" },
          ],
        };
      }
    },
  },

  "/agendamentos/ver": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const t = ctx.state.context.currentScheduledTx;
      if (!t) {
        return {
          title: "📅 Agendamento",
          options: [
            { label: "↩️ Voltar", action: "back" },
          ],
        };
      }
      const typeLabel = t.type === "income" ? "🟢 Receita" : "🔴 Despesa";
      const desc = t.description || (t.type === "income" ? "Receita" : "Despesa");
      const d = new Date(t.date);
      const dateStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
      let recLabel = "";
      if (t.recurrence === "monthly") {
        recLabel = t.recurrenceDay ? `\n🔁 Recorrente — Todo dia ${t.recurrenceDay} do mês` : "\n🔁 Recorrente — Mensal";
      } else if (t.recurrence === "weekly") {
        const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
        recLabel = t.recurrenceDay != null
          ? `\n🔁 Recorrente — Toda ${DAYS[t.recurrenceDay]}`
          : "\n🔁 Recorrente — Semanal";
      }
      await ctx.reply(
        `📅 *${desc}*\nR$ ${formatMoney(t.amount)} — ${typeLabel}\nData: ${dateStr}${recLabel}`
      );
      const options = [
        { label: "✅ Confirmar pagamento/recebimento", action: "exec", handler: "confirmarAgendamento" },
      ];
      if (t.recurrence) {
        options.push({ label: "⏭️ Pular esta ocorrência", action: "exec", handler: "pularAgendamento" });
      }
      options.push({ label: "↩️ Voltar", action: "back" });
      return {
        title: `📅 ${desc} — R$ ${formatMoney(t.amount)}`,
        options,
      };
    },
  },

  "/agendamentos/novo/tipo": {
    dynamic: false,
    options: [
      { label: "🔴 Despesa", action: "exec", handler: "setScheduleTipo", data: { type: "expense" } },
      { label: "🟢 Receita", action: "exec", handler: "setScheduleTipo", data: { type: "income" } },
      { label: "❌ Cancelar", action: "goto", target: "/agendamentos" },
    ],
    title: "📅 Novo agendamento\n\nQual o tipo?",
  },

  "/agendamentos/novo/recorrencia": {
    dynamic: false,
    options: [
      { label: "⏭️ Não repetir (único)", action: "exec", handler: "setScheduleRecorrencia", data: { recurrence: "none" } },
      { label: "🔁 Mensalmente", action: "exec", handler: "setScheduleRecorrencia", data: { recurrence: "monthly" } },
      { label: "🔁 Semanalmente", action: "exec", handler: "setScheduleRecorrencia", data: { recurrence: "weekly" } },
      { label: "❌ Cancelar", action: "goto", target: "/agendamentos" },
    ],
    title: "🔁 Repetir agendamento?",
  },

  "/agendamentos/novo/dia-semana": {
    dynamic: false,
    options: [
      { label: "Domingo", action: "exec", handler: "setScheduleDiaSemana", data: { dow: 0 } },
      { label: "Segunda-Feira", action: "exec", handler: "setScheduleDiaSemana", data: { dow: 1 } },
      { label: "Terça-Feira", action: "exec", handler: "setScheduleDiaSemana", data: { dow: 2 } },
      { label: "Quarta-Feira", action: "exec", handler: "setScheduleDiaSemana", data: { dow: 3 } },
      { label: "Quinta-Feira", action: "exec", handler: "setScheduleDiaSemana", data: { dow: 4 } },
      { label: "Sexta-Feira", action: "exec", handler: "setScheduleDiaSemana", data: { dow: 5 } },
      { label: "Sábado", action: "exec", handler: "setScheduleDiaSemana", data: { dow: 6 } },
    ],
    title: "📅 Qual dia da semana?",
  },

  "/agendamentos/novo/conta": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let accounts = [];
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        accounts = res?.accounts || [];
      } catch (e) {
        logger.warn("[financialFlow] /agendamentos/novo/conta error:", e.message);
      }
      const options = accounts.map(a => ({
        label: `🏦 ${a.name} — R$ ${formatMoney(a.balance)}`,
        action: "exec",
        handler: "setScheduleConta",
        data: { accountId: a.id },
      }));
      options.push({ label: "❌ Cancelar", action: "goto", target: "/agendamentos" });
      return { title: "🏦 Em qual conta?", options };
    },
  },

  "/agendamentos/novo/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const DOW_LABELS = ["Domingo","Segunda-Feira","Terça-Feira","Quarta-Feira","Quinta-Feira","Sexta-Feira","Sábado"];
      const { pendingScheduleType, pendingScheduleDesc, pendingScheduleAmount,
              pendingScheduleRecurrence, pendingScheduleDay, pendingScheduleAccountName } = ctx.state.context;
      const typeLabel = pendingScheduleType === "income" ? "🟢 Receita" : "🔴 Despesa";
      let recLabel = "Único (não repetir)";
      if (pendingScheduleRecurrence === "monthly") {
        recLabel = pendingScheduleDay ? `🔁 Todo dia ${pendingScheduleDay}` : "🔁 Mensalmente";
      } else if (pendingScheduleRecurrence === "weekly") {
        const dowName = pendingScheduleDay != null ? DOW_LABELS[pendingScheduleDay] : "—";
        recLabel = `🔁 Toda ${dowName}`;
      }
      return {
        title: `📅 Confirmar agendamento?\n\n${typeLabel}\n${pendingScheduleDesc || "Sem descrição"}\nR$ ${formatMoney(pendingScheduleAmount)}\n${recLabel}\nConta: ${pendingScheduleAccountName || "—"}`,
        options: [
          { label: "✅ Confirmar", action: "exec", handler: "confirmarNovoAgendamento" },
          { label: "❌ Cancelar", action: "goto", target: "/agendamentos" },
        ],
      };
    },
  },

  // ── Cartões ───────────────────────────────────────────────────────────────

  "/cartoes": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let cards = [];
      try {
        const res = await financialClient.listCards(ctx.userId);
        cards = res?.cards || [];
      } catch (e) {
        logger.warn("[financialFlow] /cartoes check error:", e.message);
      }
      const options = [];
      for (const card of cards) {
        const total = card.currentInvoice ? card.currentInvoice.totalAmount : 0;
        const limit = card.limit || 0;
        options.push({
          label: `💳 ${card.name} — R$ ${formatMoney(total)} de R$ ${formatMoney(limit)}`,
          action: "exec",
          handler: "verCartao",
          data: { cardId: card.id },
        });
      }
      options.push({ label: "➕ Adicionar cartão", action: "exec", handler: "iniciarCriarCartao" });
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: "💳 Cartões de crédito", options };
    },
  },

  "/cartoes/ver": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { currentCardId } = ctx.state.context;
      try {
        const res = await financialClient.getCurrentInvoice(ctx.userId, currentCardId);
        if (!res || !res.invoice) {
          await ctx.reply("❌ Não foi possível carregar a fatura.");
          return {
            title: "Erro",
            options: [
              { label: "↩️ Voltar", action: "back" },
            ],
          };
        }
        const { invoice, totalAmount, available, limit } = res;
        const dueStr = invoice.dueDate
          ? (() => {
              const d = new Date(invoice.dueDate);
              return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
            })()
          : "—";
        const [y, m] = invoice.period.split("-");
        const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
        const monthLabel = `${monthNames[parseInt(m, 10) - 1]} ${y}`;

        await ctx.reply(
          `💳 *${ctx.state.context.currentCardName || "Cartão"} — ${monthLabel}*\n\n` +
          `Fatura: R$ ${formatMoney(totalAmount)} | Disponível: R$ ${formatMoney(available)}\n` +
          `Vence: ${dueStr}`
        );
        return {
          title: `Fatura ${monthLabel}`,
          options: [
            { label: "📋 Ver lançamentos", action: "exec", handler: "verLancamentos" },
            { label: "💰 Pagar fatura", action: "exec", handler: "pagarFatura" },
            { label: "↩️ Voltar", action: "back" },
          ],
        };
      } catch (e) {
        logger.error("[financialFlow] /cartoes/ver error:", e.message);
        await ctx.reply("❌ Erro ao carregar fatura.");
        return {
          title: "Erro",
          options: [
            { label: "↩️ Voltar", action: "back" },
          ],
        };
      }
    },
  },

  "/cartoes/vincular": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let accounts = [];
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        accounts = (res?.accounts || []).filter(a => ["corrente", "poupanca"].includes(a.type));
      } catch (e) {
        logger.warn("[financialFlow] /cartoes/vincular error:", e.message);
      }
      const options = accounts.map(a => ({
        label: `🏦 ${a.name}`,
        action: "exec",
        handler: "vincularContaCartao",
        data: { accountId: a.id },
      }));
      options.push({ label: "➕ Criar nova conta", action: "exec", handler: "criarContaParaCartao" });
      options.push({ label: "⏭️ Pular (sem conta vinculada)", action: "exec", handler: "pularVinculo" });
      return { title: "🏦 Vincular conta para pagamento?", options };
    },
  },

  "/cartoes/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingCardName, pendingCardLimit, pendingCardClosingDay, pendingCardDueDay, pendingCardLinkedAccountId } = ctx.state.context;
      const linkedLabel = pendingCardLinkedAccountId ? "Com conta vinculada" : "Sem conta vinculada";
      return {
        title: `Criar cartão *${pendingCardName}*?\n\nLimite: R$ ${formatMoney(pendingCardLimit)}\nFechamento: dia ${pendingCardClosingDay} | Vencimento: dia ${pendingCardDueDay}\n${linkedLabel}`,
        options: [
          { label: "✅ Confirmar", action: "exec", handler: "confirmarCriarCartao" },
          { label: "❌ Cancelar", action: "goto", target: "/cartoes" },
        ],
      };
    },
  },

  "/cartoes/pagar/conta": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let accounts = [];
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        accounts = (res?.accounts || []).filter(a => ["corrente", "poupanca", "carteira"].includes(a.type));
      } catch (e) {
        logger.warn("[financialFlow] /cartoes/pagar/conta error:", e.message);
      }
      const options = accounts.map(a => ({
        label: `🏦 ${a.name} — R$ ${formatMoney(a.balance)}`,
        action: "exec",
        handler: "selecionarContaPagamento",
        data: { accountId: a.id },
      }));
      options.push({ label: "❌ Cancelar", action: "back" });
      return { title: "💳 De qual conta pagar?", options };
    },
  },

  "/cartoes/pagar/valor": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { currentCardId } = ctx.state.context;
      try {
        const res = await financialClient.getCurrentInvoice(ctx.userId, currentCardId);
        const total = res?.totalAmount || 0;
        ctx.state.context.currentInvoiceId = res?.invoice?.id;
        ctx.state.context.currentInvoiceTotal = total;
        await ctx.reply(
          `💰 *Pagamento de fatura*\n\n` +
          `Total da fatura: R$ ${formatMoney(total)}\n\n` +
          `Digite o valor a pagar (ou *${formatMoney(total)}* para pagar tudo):`
        );
      } catch (e) {
        logger.error("[financialFlow] /cartoes/pagar/valor error:", e.message);
        await ctx.reply("❌ Erro ao carregar fatura.");
      }
      ctx.state.context.awaitingPaymentAmount = true;
      return {
        title: "Digite o valor no chat",
        options: [
          { label: "❌ Cancelar", action: "goto", target: "/cartoes/ver" },
        ],
      };
    },
  },

  "/cartoes/pagar/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingPaymentAmount, currentInvoiceTotal, currentCardName } = ctx.state.context;
      const isParcial = pendingPaymentAmount < (currentInvoiceTotal || 0) - 0.01;
      const notice = isParcial ? "\n⚠️ Pagamento parcial — saldo devedor vai para próxima fatura." : "";
      return {
        title: `Pagar R$ ${formatMoney(pendingPaymentAmount)} da fatura de *${currentCardName || "cartão"}*?${notice}`,
        options: [
          { label: "✅ Confirmar pagamento", action: "exec", handler: "confirmarPagamento" },
          { label: "❌ Cancelar", action: "back" },
        ],
      };
    },
  },

  // ── Transferência ─────────────────────────────────────────────────────────

  "/transferencia": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let accounts = [];
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        accounts = res?.accounts || [];
      } catch (e) {
        logger.warn("[financialFlow] /transferencia error:", e.message);
      }
      if (!accounts.length) {
        await ctx.reply("🏦 Nenhuma conta disponível para transferência.");
        return {
          title: "Transferência",
          options: [
            { label: "↩️ Voltar", action: "back" },
            { label: "↩️ Ir ao menu", action: "goto", target: "/" },
          ],
        };
      }
      const options = accounts.map(a => ({
        label: `🏦 ${a.name} — R$ ${formatMoney(a.balance)}`,
        action: "exec",
        handler: "selecionarContaOrigem",
        data: { accountId: a.id, accountName: a.name },
      }));
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: "🔄 De qual conta?", options };
    },
  },

  "/transferencia/destino": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingTransferFrom } = ctx.state.context;
      let accounts = [];
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        accounts = (res?.accounts || []).filter(a => a.id !== pendingTransferFrom);
      } catch (e) {
        logger.warn("[financialFlow] /transferencia/destino error:", e.message);
      }
      if (!accounts.length) {
        await ctx.reply("🏦 Nenhuma outra conta disponível como destino.");
        return {
          title: "Destino",
          options: [
            { label: "↩️ Voltar", action: "back" },
            { label: "↩️ Ir ao menu", action: "goto", target: "/" },
          ],
        };
      }
      const options = accounts.map(a => ({
        label: `🏦 ${a.name} — R$ ${formatMoney(a.balance)}`,
        action: "exec",
        handler: "selecionarContaDestino",
        data: { accountId: a.id, accountName: a.name },
      }));
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: "🔄 Para qual conta?", options };
    },
  },

  "/transferencia/confirmar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { pendingTransferFromName, pendingTransferToName, pendingTransferAmount } = ctx.state.context;
      return {
        title: `Transferir R$ ${formatMoney(pendingTransferAmount)} de *${pendingTransferFromName}* para *${pendingTransferToName}*?`,
        options: [
          { label: "✅ Confirmar", action: "exec", handler: "confirmarTransferencia" },
          { label: "❌ Cancelar", action: "goto", target: "/transferencia" },
        ],
      };
    },
  },

  // ── Edição de lançamentos ─────────────────────────────────────────────────

  "/lancamentos/editar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const txs = ctx.state.context.extratoTransacoes || [];
      if (!txs.length) {
        await ctx.reply("📋 Nenhum lançamento disponível para edição.");
        return {
          title: "Lançamentos",
          options: [
            { label: "↩️ Voltar", action: "back" },
            { label: "↩️ Ir ao extrato", action: "goto", target: "/extrato" },
          ],
        };
      }
      const options = txs.map(t => {
        const emoji = t.type === "income" ? "🟢" : "🔴";
        const sign = t.type === "income" ? "+" : "-";
        const desc = t.description || (t.type === "income" ? "Receita" : "Despesa");
        const dateLabel = formatDate(t.date);
        return {
          label: `${emoji} ${sign}R$ ${formatMoney(t.amount)} — ${desc} (${dateLabel})`,
          action: "exec",
          handler: "selecionarLancamentoEditar",
          data: {
            txId: t.id,
            amount: t.amount,
            description: t.description,
            type: t.type,
            date: t.date,
            recurrence: t.recurrence || null,
            installmentGroupId: t.installmentGroupId,
            installmentNumber: t.installmentNumber,
            installmentTotal: t.installmentTotal,
          },
        };
      });
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: "✏️ Qual lançamento editar?", options };
    },
  },

  "/lancamentos/editar/opcoes": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { editingTxInstallmentGroupId, editingTxInstallmentNumber, editingTxInstallmentTotal, editingTxRecurrence } = ctx.state.context;
      const options = [
        { label: "💰 Editar valor", action: "exec", handler: "awaitEditTxAmount" },
        { label: "📝 Editar descrição", action: "exec", handler: "awaitEditTxDesc" },
      ];
      if (editingTxRecurrence) {
        options.push({ label: "🗑️ Cancelar recorrência", action: "goto", target: "/lancamentos/editar/confirmar-excluir-recorrente" });
      } else {
        options.push({ label: "🗑️ Excluir", action: "exec", handler: "excluirLancamento" });
      }
      if (editingTxInstallmentGroupId) {
        options.push({ label: `🗂️ Gerenciar parcelas (${editingTxInstallmentNumber}/${editingTxInstallmentTotal})`, action: "goto", target: "/lancamentos/parcelas" });
      }
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: "✏️ O que deseja fazer?", options };
    },
  },

  "/lancamentos/editar/confirmar-excluir-recorrente": {
    dynamic: false,
    title: "⚠️ Cancelar recorrência?\n\nAo excluir este lançamento, todos os ciclos futuros também serão cancelados — pois eles ainda não foram gerados.",
    options: [
      { label: "🗑️ Sim, cancelar recorrência", action: "exec", handler: "excluirLancamento" },
      { label: "↩️ Não, manter", action: "back" },
    ],
  },

  "/lancamentos/parcelas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const { editingTxInstallmentNumber, editingTxInstallmentTotal } = ctx.state.context;
      const nextNum = (editingTxInstallmentNumber || 0) + 1;
      const options = [];
      if (nextNum <= (editingTxInstallmentTotal || 0)) {
        options.push({ label: `❌ Cancelar parcelas futuras (${nextNum} em diante)`, action: "exec", handler: "cancelarParcelasFuturas" });
      }
      options.push({ label: "❌ Cancelar todas as parcelas", action: "exec", handler: "cancelarTodasParcelas" });
      options.push({ label: "✏️ Editar valor desta em diante", action: "exec", handler: "awaitEditInstallmentAmount" });
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: `🗂️ Gerenciar parcelas (${editingTxInstallmentNumber}/${editingTxInstallmentTotal})`, options };
    },
  },

  // ── Configurações ─────────────────────────────────────────────────────────

  "/config": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let notifHour = 9;
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        // listAccounts triggers vault resolution; grab notificationHour separately via a budget call
        // We store it in context when set; otherwise show default
        notifHour = ctx.state.context.notificationHour ?? 9;
      } catch (e) { /* ignore */ }
      const notifMin = ctx.state.context.notificationMinute ?? 0;
      const notifLabel = `${String(notifHour).padStart(2, "0")}:${String(notifMin).padStart(2, "0")}`;
      return {
        title: "⚙️ Configurações",
        options: [
          { label: "⭐ Conta padrão", action: "goto", target: "/config/conta-padrao" },
          { label: `🔔 Notificações — ${notifLabel}`, action: "goto", target: "/config/notificacoes" },
          { label: "🔗 Desvincular conta Google", action: "goto", target: "/config/desvincular" },
          { label: "↩️ Voltar", action: "back" },
        ],
      };
    },
  },

  "/config/conta-padrao": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      let accounts = [];
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        accounts = res?.accounts || [];
      } catch (e) {
        logger.warn("[financialFlow] /config/conta-padrao error:", e.message);
      }
      if (!accounts.length) {
        await ctx.reply("🏦 Nenhuma conta cadastrada ainda.");
        return {
          title: "Conta padrão",
          options: [{ label: "↩️ Voltar", action: "back" }, { label: "➕ Adicionar conta", action: "goto", target: "/contas/tipo" }],
        };
      }
      const options = accounts.map(a => ({
        label: `${a.isDefault ? "⭐ " : ""}${a.name}`,
        action: "exec",
        handler: "definirContaPadrao",
        data: { accountId: a.id, fromConfig: true },
      }));
      options.push({ label: "↩️ Voltar", action: "back" });
      return { title: "⭐ Qual conta usar como padrão?", options };
    },
  },

  "/config/notificacoes": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      const hour = ctx.state.context.notificationHour ?? 9;
      const min = ctx.state.context.notificationMinute ?? 0;
      const current = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      await ctx.reply(
        `🔔 *Horário de notificações*\n\n` +
        `Atualmente: *${current}*\n\n` +
        `Digite o novo horário no formato *HH:MM* (ex: 9:00, 12:30, 20:00):`
      );
      ctx.state.context.awaitingNotifHour = true;
      return { noRender: true };
    },
  },

  "/config/desvincular": {
    title: "⚠️ Desvincular conta Google?",
    options: [
      { label: "✅ Sim, desvincular", action: "exec", handler: "confirmarDesvincular" },
      { label: "❌ Cancelar", action: "back" },
    ],
  },

  // ── Dúvidas ───────────────────────────────────────────────────────────────

  "/duvidas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await ctx.reply(
        "❓ *Dúvidas — Assistente Financeiro*\n\n" +

        "📝 *Registrar transação*\n" +
        "Envie uma frase natural:\n" +
        "• \"Gastei 50 reais de uber\"\n" +
        "• \"Recebi 3200 de salário\"\n" +
        "• \"Paguei 120 de mercado ontem\"\n\n" +

        "🔁 *Parcelamento*\n" +
        "• \"Comprei notebook por 3000 em 12x\"\n\n" +

        "📅 *Lançamento futuro / recorrente*\n" +
        "• \"Vou pagar 800 de aluguel todo dia 5\"\n" +
        "• \"Recebi 3200 de salário toda segunda\"\n\n" +

        "🔄 *Transferência entre contas*\n" +
        "Use o menu *Contas › Transferir saldo entre contas*.\n\n" +

        "🔍 *Consultas rápidas* (sem abrir o menu)\n" +
        "• \"Qual meu saldo?\"\n" +
        "• \"Quanto gastei esse mês?\"\n" +
        "• \"Meus agendamentos\"\n" +
        "• \"Como está meu orçamento?\"\n\n" +

        "🏦 *Saldo projetado*\n" +
        "Em *Contas › Ver contas*, o saldo projetado considera todos os lançamentos futuros pendentes.\n\n" +

        "🔒 *Segurança*\n" +
        "Tudo é criptografado com sua chave pessoal."
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
        const [res, schedRes] = await Promise.all([
          financialClient.listAccounts(ctx.userId),
          financialClient.listScheduled(ctx.userId).catch(() => null),
        ]);
        if (!res?.accounts?.length) {
          await ctx.reply("🏦 Você ainda não tem contas cadastradas.\n\nUse *Adicionar conta* para criar uma.");
          return { noRender: true };
        }
        const total = res.accounts.reduce((s, a) => s + (a.balance || 0), 0);
        const totalProjected = res.accounts.reduce((s, a) => s + (a.projectedBalance ?? a.balance ?? 0), 0);
        const lines = res.accounts.map(a => {
          const type = ACCOUNT_TYPES.find(t => t.key === a.type)?.label || a.type;
          const sign = a.balance < 0 ? "🔴" : "🟢";
          return `${sign} *${a.name}* (${type}): R$ ${formatMoney(a.balance)}`;
        });
        const hasPending = Math.abs(totalProjected - total) >= 0.01;
        let projLine = "";
        if (hasPending) {
          const pending = (schedRes?.transactions || []).sort((a, b) => new Date(a.date) - new Date(b.date));
          const lastDate = pending.length ? formatDate(new Date(pending[pending.length - 1].date)) : null;
          const shown = pending.slice(0, 3);
          const rest = pending.length - shown.length;
          const breakdownLines = shown.map(t => {
            const sign = t.type === "income" ? "+" : "-";
            const desc = t.description || (t.type === "income" ? "Receita" : "Despesa");
            const dayNote = (t.recurrence === "monthly" && t.recurrenceDay) ? ` (dia ${t.recurrenceDay})` : "";
            return `   └ ${sign}R$ ${formatMoney(t.amount)} ${desc}${dayNote}`;
          });
          if (rest > 0) breakdownLines.push(`   └ e mais ${rest}...`);
          projLine = `\n📈 *Projetado${lastDate ? ` até ${lastDate}` : ""}: R$ ${formatMoney(totalProjected)}*` +
            (breakdownLines.length ? "\n" + breakdownLines.join("\n") : "");
        }
        await ctx.reply(
          `🏦 *Suas contas:*\n\n${lines.join("\n")}\n\n` +
          `💰 *Total: R$ ${formatMoney(total)}*` +
          projLine
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
      ctx.state.context.editingAccountIsDefault = data.accountIsDefault || false;
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
        const [catsRes, budgetsRes, txCurrentRes, txAllRes] = await Promise.all([
          financialClient.listCategories(ctx.userId),
          financialClient.listBudgets(ctx.userId),
          financialClient.listTransactions(ctx.userId, { period: "current", limit: 500 }),
          financialClient.listTransactions(ctx.userId, { limit: 2000 }),
        ]);

        if (!catsRes?.categories?.length) {
          await ctx.reply("🏷️ Nenhuma categoria encontrada.");
          return { noRender: true };
        }

        // Gasto por categoryId este mês
        const spentById = {};
        for (const t of (txCurrentRes?.transactions || [])) {
          if (t.type !== "expense" || !t.categoryId) continue;
          spentById[t.categoryId] = (spentById[t.categoryId] || 0) + (t.amount || 0);
        }

        // Categorias já usadas em alguma transação (all-time)
        const usedCategoryIds = new Set();
        for (const t of (txAllRes?.transactions || [])) {
          if (t.categoryId) usedCategoryIds.add(t.categoryId);
        }

        // Limite de orçamento por categoryId
        const budgetById = {};
        for (const b of (budgetsRes?.budgets || [])) {
          if (b.categoryId) budgetById[b.categoryId] = b.limit;
        }

        function suffix(spent, budget) {
          if (budget !== undefined && spent > 0) return ` (R$ ${formatMoney(spent)}/R$ ${formatMoney(budget)})`;
          if (budget !== undefined) return ` (R$ 0/R$ ${formatMoney(budget)})`;
          if (spent > 0) return ` (R$ ${formatMoney(spent)})`;
          return "";
        }

        const lines = ["🏷️ *Categorias — este mês:*\n"];
        for (const cat of catsRes.categories) {
          // Subcategorias: só exibe as que foram usadas em pelo menos uma transação
          const usedSubs = (cat.children || []).filter(
            (sub) => usedCategoryIds.has(sub.id) || budgetById[sub.id] !== undefined
          );
          const ownSpent = spentById[cat.id] || 0;
          const subSpent = usedSubs.reduce((s, c) => s + (spentById[c.id] || 0), 0);
          const totalSpent = ownSpent + subSpent;

          // Exibe categoria pai se tiver uso próprio, orçamento, ou subcategorias usadas
          if (ownSpent === 0 && budgetById[cat.id] === undefined && usedSubs.length === 0) continue;

          lines.push(`• *${cat.name}*${suffix(totalSpent, budgetById[cat.id])}`);
          for (const sub of usedSubs) {
            lines.push(`  ↳ ${sub.name}${suffix(spentById[sub.id] || 0, budgetById[sub.id])}`);
          }
        }

        if (lines.length === 1) {
          await ctx.reply("🏷️ Nenhuma categoria com transações ainda.\n\nRegistre uma despesa ou receita para começar.");
          return { noRender: true };
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

    nlpSelecionarCategoriaPai: async (ctx, data) => {
      if (!ctx.state.context.pendingNlpTransaction) return { noRender: true };
      ctx.state.context.nlpSelectedParentCat = { id: data.categoryId, name: data.categoryName };
      ctx.state.path = "/nlp-confirm/categoria/subs";
    },

    nlpNovaCategoriaInput: async (ctx) => {
      if (!ctx.state.context.pendingNlpTransaction) return { noRender: true };
      ctx.state.context.awaitingNlpNovaCategoria = true;
      await ctx.reply("📝 Digite o nome da nova categoria:");
      return { noRender: true };
    },

    nlpNovaSubcategoriaInput: async (ctx) => {
      if (!ctx.state.context.pendingNlpTransaction) return { noRender: true };
      ctx.state.context.awaitingNlpNovaSubcategoria = true;
      await ctx.reply("📝 Digite o nome da nova subcategoria:");
      return { noRender: true };
    },

    setCategoriaNlp: async (ctx, data) => {
      if (!ctx.state.context.pendingNlpTransaction) return { noRender: true };
      ctx.state.context.pendingNlpTransaction.suggestedCategoryId = data.categoryId || null;
      ctx.state.context.pendingNlpTransaction.suggestedCategoryName = data.categoryName || null;
      ctx.state.context.pendingNlpTransaction.suggestedCategoryParentName = data.parentName || null;
      ctx.state.path = "/nlp-confirm";
    },

    confirmarNlp: async (ctx) => {
      const tx = ctx.state.context.pendingNlpTransaction;
      if (!tx) return { end: true };
      try {
        if (tx.installmentCount && tx.installmentCount >= 2) {
          await financialClient.createInstallment(ctx.userId, {
            accountId: tx.accountId,
            amount: tx.amount,
            description: tx.description,
            type: tx.type,
            date: tx.date,
            installmentCount: tx.installmentCount,
            categoryId: tx.suggestedCategoryId || undefined,
          });
          const amountEach = tx.amount / tx.installmentCount;
          await ctx.reply(
            `✅ *Parcelamento registrado!*\n\n` +
            `${tx.installmentCount}x de R$ ${formatMoney(amountEach)}` +
            (tx.description ? ` — ${tx.description}` : "") +
            `\n\nTotal: R$ ${formatMoney(tx.amount)}`
          );
        } else {
          const result = await financialClient.createTransaction(ctx.userId, {
            accountId: tx.accountId,
            amount: tx.amount,
            description: tx.description,
            type: tx.type,
            date: tx.date,
            status: tx.isPending ? "pending" : "confirmed",
            recurrence: tx.recurrence || undefined,
            recurrenceDay: tx.recurrenceDay != null ? tx.recurrenceDay : undefined,
            categoryId: tx.suggestedCategoryId || undefined,
          });
          const sign = tx.type === "income" ? "+" : "-";
          const descLine = tx.description ? ` — ${tx.description}` : "";
          const amountLine = `${sign}R$ ${formatMoney(tx.amount)}${descLine}`;

          let msg;
          if (tx.recurrence === "monthly") {
            const action = tx.type === "income" ? "recebimento" : "pagamento";
            const dayLabel = tx.recurrenceDay ? `dia ${tx.recurrenceDay}` : "todo mês";
            msg = `📅 *${tx.type === "income" ? "Receita" : "Despesa"} recorrente agendada!*\n\n` +
              `${amountLine}\n` +
              `🔁 Todo ${dayLabel} do mês\n` +
              `📲 Vou te notificar no ${dayLabel} para confirmar o ${action}`;
          } else if (tx.recurrence === "weekly") {
            const action = tx.type === "income" ? "recebimento" : "pagamento";
            msg = `📅 *${tx.type === "income" ? "Receita" : "Despesa"} recorrente agendada!*\n\n` +
              `${amountLine}\n` +
              `🔁 Toda semana\n` +
              `📲 Vou te notificar semanalmente para confirmar o ${action}`;
          } else if (tx.isPending) {
            const action = tx.type === "income" ? "recebimento" : "pagamento";
            const dateLabel = formatDate(new Date(tx.date));
            msg = `⏳ *${tx.type === "income" ? "Receita" : "Despesa"} pendente registrada!*\n\n` +
              `${amountLine}\n` +
              `📆 Previsto para ${dateLabel}\n` +
              `📲 Vou te notificar na data para confirmar o ${action}`;
          } else {
            const typeLabel = tx.type === "income" ? "Receita" : "Despesa";
            const balanceText = result.newBalance !== undefined
              ? `\n\nSaldo *${tx.accountName}*: R$ ${formatMoney(result.newBalance)}`
              : "";
            msg = `✅ *${typeLabel} registrada!*\n\n${amountLine}${balanceText}`;
          }

          await ctx.reply(msg);
          if (!tx.recurrence && !tx.isPending) await handleBudgetAlerts(ctx, result);
        }
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

    // ── Agendamentos ──────────────────────────────────────────────────────────

    iniciarNovoAgendamento: async (ctx) => {
      ctx.state.context.pendingScheduleType = null;
      ctx.state.context.pendingScheduleDesc = null;
      ctx.state.context.pendingScheduleAmount = null;
      ctx.state.context.pendingScheduleRecurrence = null;
      ctx.state.context.pendingScheduleDay = null;
      ctx.state.context.pendingScheduleAccountId = null;
      ctx.state.context.pendingScheduleAccountName = null;
      ctx.state.path = "/agendamentos/novo/tipo";
    },

    setScheduleTipo: async (ctx, data) => {
      ctx.state.context.pendingScheduleType = data.type;
      ctx.state.context.awaitingScheduleDesc = true;
      const label = data.type === "income" ? "receita" : "despesa";
      await ctx.reply(`✏️ Digite a *descrição* do agendamento (ex: Aluguel, Salário, Academia):`);
      return { noRender: true };
    },

    setScheduleRecorrencia: async (ctx, data) => {
      const recurrence = data.recurrence === "none" ? null : data.recurrence;
      ctx.state.context.pendingScheduleRecurrence = recurrence;
      if (recurrence === "monthly") {
        ctx.state.context.awaitingScheduleDay = true;
        await ctx.reply("📅 Qual o *dia do mês* para repetir? (1–31):");
        return { noRender: true };
      }
      if (recurrence === "weekly") {
        ctx.state.context.pendingScheduleDay = null;
        ctx.state.path = "/agendamentos/novo/dia-semana";
        return;
      }
      ctx.state.path = "/agendamentos/novo/conta";
    },

    setScheduleDiaSemana: async (ctx, data) => {
      ctx.state.context.pendingScheduleDay = data.dow;
      ctx.state.path = "/agendamentos/novo/conta";
    },

    setScheduleConta: async (ctx, data) => {
      try {
        const res = await financialClient.listAccounts(ctx.userId);
        const account = (res?.accounts || []).find(a => a.id === data.accountId);
        ctx.state.context.pendingScheduleAccountId = data.accountId;
        ctx.state.context.pendingScheduleAccountName = account ? account.name : data.accountId;
      } catch (e) {
        ctx.state.context.pendingScheduleAccountId = data.accountId;
      }
      ctx.state.path = "/agendamentos/novo/confirmar";
    },

    confirmarNovoAgendamento: async (ctx) => {
      const { pendingScheduleType, pendingScheduleDesc, pendingScheduleAmount,
              pendingScheduleRecurrence, pendingScheduleDay, pendingScheduleAccountId } = ctx.state.context;
      try {
        // Calcular data inicial
        const now = new Date();
        let scheduleDate = new Date();
        if (pendingScheduleRecurrence === "monthly" && pendingScheduleDay) {
          const thisMonth = new Date(now.getFullYear(), now.getMonth(), pendingScheduleDay);
          scheduleDate = thisMonth > now ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, pendingScheduleDay);
        } else if (pendingScheduleRecurrence === "weekly" && pendingScheduleDay != null) {
          // Próxima ocorrência do dia da semana informado
          const diff = (pendingScheduleDay - now.getDay() + 7) % 7 || 7;
          scheduleDate = new Date(now);
          scheduleDate.setDate(now.getDate() + diff);
        }

        await financialClient.createTransaction(ctx.userId, {
          accountId: pendingScheduleAccountId,
          amount: pendingScheduleAmount,
          description: pendingScheduleDesc,
          type: pendingScheduleType,
          date: scheduleDate.toISOString(),
          status: "pending",
          recurrence: pendingScheduleRecurrence || null,
          recurrenceDay: pendingScheduleDay || null,
        });

        const DOW_LABELS = ["Domingo","Segunda-Feira","Terça-Feira","Quarta-Feira","Quinta-Feira","Sexta-Feira","Sábado"];
        const recLabel = pendingScheduleRecurrence === "monthly"
          ? `\n🔁 Repete todo dia ${pendingScheduleDay || "—"}`
          : pendingScheduleRecurrence === "weekly"
          ? `\n🔁 Repete toda ${pendingScheduleDay != null ? DOW_LABELS[pendingScheduleDay] : "semana"}`
          : "";
        await ctx.reply(
          `✅ *Agendamento criado!*\n\n` +
          `${pendingScheduleType === "income" ? "🟢" : "🔴"} ${pendingScheduleDesc}\n` +
          `R$ ${formatMoney(pendingScheduleAmount)}${recLabel}`
        );
        // limpar context
        ctx.state.context.pendingScheduleType = null;
        ctx.state.context.pendingScheduleDesc = null;
        ctx.state.context.pendingScheduleAmount = null;
        ctx.state.context.pendingScheduleRecurrence = null;
        ctx.state.context.pendingScheduleDay = null;
        ctx.state.context.pendingScheduleAccountId = null;
        ctx.state.context.pendingScheduleAccountName = null;
        ctx.state.path = "/agendamentos";
      } catch (e) {
        logger.error("[financialFlow] confirmarNovoAgendamento error:", e.message);
        await ctx.reply("❌ Erro ao criar agendamento. Tente novamente.");
        return { noRender: true };
      }
    },

    verAgendamento: async (ctx, data) => {
      try {
        const res = await financialClient.listScheduled(ctx.userId);
        const txs = res?.transactions || [];
        const tx = txs.find(t => t.id === data.transactionId) || null;
        if (!tx) {
          await ctx.reply("❌ Agendamento não encontrado.");
          ctx.state.path = "/agendamentos";
          return;
        }
        ctx.state.context.currentScheduledId = data.transactionId;
        ctx.state.context.currentScheduledTx = tx;
        ctx.state.path = "/agendamentos/ver";
      } catch (e) {
        logger.error("[financialFlow] verAgendamento error:", e.message);
        await ctx.reply("❌ Erro ao carregar agendamento.");
        return { noRender: true };
      }
    },

    confirmarAgendamento: async (ctx) => {
      const { currentScheduledId, currentScheduledTx } = ctx.state.context;
      if (!currentScheduledId) {
        await ctx.reply("❌ Nenhum agendamento selecionado.");
        ctx.state.path = "/agendamentos";
        return;
      }
      try {
        const result = await financialClient.confirmTransaction(ctx.userId, currentScheduledId);
        if (!result || !result.ok) {
          await ctx.reply("❌ Erro ao confirmar agendamento. Tente novamente.");
          return { noRender: true };
        }
        const desc = currentScheduledTx?.description || (currentScheduledTx?.type === "income" ? "Receita" : "Despesa");
        const balanceText = result.newBalance !== undefined
          ? `\n\nSaldo atualizado: R$ ${formatMoney(result.newBalance)}`
          : "";
        await ctx.reply(`✅ *${desc}* confirmado!${balanceText}`);
        await handleBudgetAlerts(ctx, result);
        ctx.state.context.currentScheduledId = null;
        ctx.state.context.currentScheduledTx = null;
        ctx.state.path = "/agendamentos";
      } catch (e) {
        logger.error("[financialFlow] confirmarAgendamento error:", e.message);
        await ctx.reply("❌ Erro ao confirmar. Tente novamente.");
        return { noRender: true };
      }
    },

    pularAgendamento: async (ctx) => {
      const { currentScheduledId } = ctx.state.context;
      if (!currentScheduledId) {
        await ctx.reply("❌ Nenhum agendamento selecionado.");
        ctx.state.path = "/agendamentos";
        return;
      }
      try {
        const result = await financialClient.skipTransaction(ctx.userId, currentScheduledId);
        if (!result || !result.ok) {
          await ctx.reply("❌ Erro ao pular ocorrência. Tente novamente.");
          return { noRender: true };
        }
        await ctx.reply("⏭️ Ocorrência pulada.");
        ctx.state.context.currentScheduledId = null;
        ctx.state.context.currentScheduledTx = null;
        ctx.state.path = "/agendamentos";
      } catch (e) {
        logger.error("[financialFlow] pularAgendamento error:", e.message);
        await ctx.reply("❌ Erro ao pular. Tente novamente.");
        return { noRender: true };
      }
    },

    // ── Definir conta padrão ─────────────────────────────────────────────────

    definirContaPadrao: async (ctx, data) => {
      const accountId = data?.accountId || ctx.state.context.editingAccountId;
      const fromConfig = data?.fromConfig || false;
      try {
        await financialClient.updateAccount(ctx.userId, accountId, { isDefault: true });
        ctx.state.context.editingAccountIsDefault = true;
        await ctx.reply("⭐ Conta definida como padrão!");
        ctx.state.path = fromConfig ? "/config" : "/contas";
      } catch (e) {
        logger.error("[financialFlow] definirContaPadrao error:", e.message);
        await ctx.reply("❌ Erro ao definir conta padrão.");
        return { noRender: true };
      }
    },

    // ── Transferência ────────────────────────────────────────────────────────

    selecionarContaOrigem: async (ctx, data) => {
      ctx.state.context.pendingTransferFrom = data.accountId;
      ctx.state.context.pendingTransferFromName = data.accountName;
      ctx.state.path = "/transferencia/destino";
    },

    selecionarContaDestino: async (ctx, data) => {
      ctx.state.context.pendingTransferTo = data.accountId;
      ctx.state.context.pendingTransferToName = data.accountName;
      ctx.state.context.awaitingTransferAmount = true;
      await ctx.reply("💰 Valor a transferir (ex: 500):");
      return { noRender: true };
    },

    confirmarTransferencia: async (ctx) => {
      const { pendingTransferFrom, pendingTransferTo, pendingTransferAmount, pendingTransferFromName, pendingTransferToName } = ctx.state.context;
      try {
        const result = await financialClient.createTransfer(ctx.userId, {
          fromAccountId: pendingTransferFrom,
          toAccountId: pendingTransferTo,
          amount: pendingTransferAmount,
          description: "Transferência",
          date: new Date().toISOString(),
        });
        await ctx.reply(
          `✅ *Transferência realizada!*\n\n` +
          `R$ ${formatMoney(pendingTransferAmount)} de *${pendingTransferFromName}* → *${pendingTransferToName}*\n\n` +
          `Saldo *${pendingTransferFromName}*: R$ ${formatMoney(result.newFromBalance)}\n` +
          `Saldo *${pendingTransferToName}*: R$ ${formatMoney(result.newToBalance)}`
        );
        ctx.state.context.pendingTransferFrom = null;
        ctx.state.context.pendingTransferFromName = null;
        ctx.state.context.pendingTransferTo = null;
        ctx.state.context.pendingTransferToName = null;
        ctx.state.context.pendingTransferAmount = null;
        ctx.state.path = "/";
      } catch (e) {
        logger.error("[financialFlow] confirmarTransferencia error:", e.message);
        await ctx.reply("❌ Erro ao realizar transferência. Tente novamente.");
        return { noRender: true };
      }
    },

    // ── Edição de lançamentos ─────────────────────────────────────────────────

    iniciarEditarLancamento: async (ctx) => {
      ctx.state.path = "/lancamentos/editar";
    },

    selecionarLancamentoEditar: async (ctx, data) => {
      ctx.state.context.editingTxId = data.txId;
      ctx.state.context.editingTxAmount = data.amount;
      ctx.state.context.editingTxDescription = data.description;
      ctx.state.context.editingTxRecurrence = data.recurrence || null;
      ctx.state.context.editingTxInstallmentGroupId = data.installmentGroupId || null;
      ctx.state.context.editingTxInstallmentNumber = data.installmentNumber || null;
      ctx.state.context.editingTxInstallmentTotal = data.installmentTotal || null;
      ctx.state.path = "/lancamentos/editar/opcoes";
    },

    awaitEditTxAmount: async (ctx) => {
      ctx.state.context.awaitingEditTxAmount = true;
      await ctx.reply(`💰 Digite o novo valor em R$ (atual: R$ ${formatMoney(ctx.state.context.editingTxAmount)}):`);
      return { noRender: true };
    },

    awaitEditTxDesc: async (ctx) => {
      ctx.state.context.awaitingEditTxDesc = true;
      await ctx.reply(`📝 Digite a nova descrição (atual: ${ctx.state.context.editingTxDescription || "sem descrição"}):`);
      return { noRender: true };
    },

    excluirLancamento: async (ctx) => {
      const { editingTxId } = ctx.state.context;
      try {
        await financialClient.deleteTransaction(ctx.userId, editingTxId);
        await ctx.reply("🗑️ Lançamento excluído.");
        ctx.state.context.editingTxId = null;
        ctx.state.path = "/extrato";
      } catch (e) {
        logger.error("[financialFlow] excluirLancamento error:", e.message);
        await ctx.reply("❌ Erro ao excluir lançamento.");
        return { noRender: true };
      }
    },

    // ── Parcelas ─────────────────────────────────────────────────────────────

    cancelarParcelasFuturas: async (ctx) => {
      const { editingTxInstallmentGroupId, editingTxInstallmentNumber } = ctx.state.context;
      const fromNum = (editingTxInstallmentNumber || 0) + 1;
      try {
        await financialClient.deleteInstallments(ctx.userId, editingTxInstallmentGroupId, fromNum);
        await ctx.reply("✅ Parcelas futuras canceladas.");
        ctx.state.context.editingTxId = null;
        ctx.state.context.editingTxInstallmentGroupId = null;
        ctx.state.path = "/extrato";
      } catch (e) {
        logger.error("[financialFlow] cancelarParcelasFuturas error:", e.message);
        await ctx.reply("❌ Erro ao cancelar parcelas.");
        return { noRender: true };
      }
    },

    cancelarTodasParcelas: async (ctx) => {
      const { editingTxInstallmentGroupId } = ctx.state.context;
      try {
        await financialClient.deleteInstallments(ctx.userId, editingTxInstallmentGroupId);
        await ctx.reply("✅ Todas as parcelas canceladas.");
        ctx.state.context.editingTxId = null;
        ctx.state.context.editingTxInstallmentGroupId = null;
        ctx.state.path = "/extrato";
      } catch (e) {
        logger.error("[financialFlow] cancelarTodasParcelas error:", e.message);
        await ctx.reply("❌ Erro ao cancelar parcelas.");
        return { noRender: true };
      }
    },

    awaitEditInstallmentAmount: async (ctx) => {
      ctx.state.context.awaitingEditInstallmentAmount = true;
      await ctx.reply(`💰 Novo valor para as parcelas em R$ (atual: R$ ${formatMoney(ctx.state.context.editingTxAmount)}):`);
      return { noRender: true };
    },

    // ── Config ───────────────────────────────────────────────────────────────

    confirmarDesvincular: async (ctx) => {
      try {
        await financialClient.deleteVault(ctx.userId);
        await ctx.reply(
          "🔗 *Conta Google desvinculada.*\n\n" +
          "Seus dados financeiros foram removidos. " +
          "Você pode criar um novo cofre a qualquer momento pelo menu financeiro."
        );
        return { end: true };
      } catch (e) {
        logger.error("[financialFlow] confirmarDesvincular error:", e.message);
        await ctx.reply("❌ Erro ao desvincular. Tente novamente.");
        return { noRender: true };
      }
    },

    // ── Cartões ──────────────────────────────────────────────────────────────

    verCartao: async (ctx, data) => {
      const cards = (await financialClient.listCards(ctx.userId))?.cards || [];
      const card = cards.find(c => c.id === data.cardId) || null;
      ctx.state.context.currentCardId = data.cardId;
      ctx.state.context.currentCardLinkedAccountId = card ? card.linkedAccountId : null;
      ctx.state.context.currentCardName = card ? card.name : null;
      ctx.state.path = "/cartoes/ver";
    },

    iniciarCriarCartao: async (ctx) => {
      ctx.state.context.pendingCardName = null;
      ctx.state.context.pendingCardLimit = null;
      ctx.state.context.pendingCardClosingDay = null;
      ctx.state.context.pendingCardDueDay = null;
      ctx.state.context.pendingCardLinkedAccountId = null;
      ctx.state.context.awaitingCardName = true;
      await ctx.reply("✏️ Digite o *nome* do cartão (ex: Nubank, C6, Inter):");
      return { noRender: true };
    },

    vincularContaCartao: async (ctx, data) => {
      ctx.state.context.pendingCardLinkedAccountId = data.accountId;
      ctx.state.path = "/cartoes/confirmar";
    },

    criarContaParaCartao: async (ctx) => {
      try {
        const name = ctx.state.context.pendingCardName || "Conta cartão";
        const result = await financialClient.createAccount(ctx.userId, {
          name,
          type: "corrente",
          balance: 0,
          isDefault: false,
        });
        ctx.state.context.pendingCardLinkedAccountId = result.id;
        ctx.state.path = "/cartoes/confirmar";
      } catch (e) {
        logger.error("[financialFlow] criarContaParaCartao error:", e.message);
        await ctx.reply("❌ Erro ao criar conta. Tente novamente.");
        return { noRender: true };
      }
    },

    pularVinculo: async (ctx) => {
      ctx.state.context.pendingCardLinkedAccountId = null;
      ctx.state.path = "/cartoes/confirmar";
    },

    confirmarCriarCartao: async (ctx) => {
      const { pendingCardName, pendingCardLimit, pendingCardClosingDay, pendingCardDueDay, pendingCardLinkedAccountId } = ctx.state.context;
      try {
        await financialClient.createCard(ctx.userId, {
          name: pendingCardName,
          limit: pendingCardLimit,
          closingDay: pendingCardClosingDay,
          dueDay: pendingCardDueDay,
          linkedAccountId: pendingCardLinkedAccountId || undefined,
        });
        await ctx.reply(
          `✅ *Cartão criado!*\n\n💳 ${pendingCardName}\n` +
          `Limite: R$ ${formatMoney(pendingCardLimit)}\n` +
          `Fechamento: dia ${pendingCardClosingDay} | Vencimento: dia ${pendingCardDueDay}`
        );
        ctx.state.context.pendingCardName = null;
        ctx.state.context.pendingCardLimit = null;
        ctx.state.context.pendingCardClosingDay = null;
        ctx.state.context.pendingCardDueDay = null;
        ctx.state.context.pendingCardLinkedAccountId = null;
        ctx.state.path = "/cartoes";
      } catch (e) {
        logger.error("[financialFlow] confirmarCriarCartao error:", e.message);
        await ctx.reply("❌ Erro ao criar cartão. Tente novamente.");
        return { noRender: true };
      }
    },

    verLancamentos: async (ctx) => {
      const { currentCardId } = ctx.state.context;
      try {
        const res = await financialClient.getCurrentInvoice(ctx.userId, currentCardId);
        const txs = res?.transactions || [];
        if (!txs.length) {
          await ctx.reply("📋 Nenhum lançamento nesta fatura.");
          return { noRender: true };
        }
        const lines = [`📋 *Lançamentos — fatura ${res.invoice.period}:*\n`];
        for (const t of txs) {
          const emoji = t.type === "income" ? "🟢" : "🔴";
          const sign = t.type === "income" ? "+" : "-";
          const desc = t.description || "Lançamento";
          const d = new Date(t.date);
          const dateStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
          lines.push(`${emoji} ${dateStr}  ${sign}R$ ${formatMoney(t.amount)}  ${desc}`);
        }
        lines.push(`\n💰 *Total: R$ ${formatMoney(res.totalAmount)}*`);
        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[financialFlow] verLancamentos error:", e.message);
        await ctx.reply("❌ Erro ao carregar lançamentos.");
      }
      return { noRender: true };
    },

    pagarFatura: async (ctx) => {
      const { currentCardLinkedAccountId } = ctx.state.context;
      if (currentCardLinkedAccountId) {
        ctx.state.context.pendingPaymentAccountId = currentCardLinkedAccountId;
        ctx.state.path = "/cartoes/pagar/valor";
      } else {
        ctx.state.path = "/cartoes/pagar/conta";
      }
    },

    selecionarContaPagamento: async (ctx, data) => {
      ctx.state.context.pendingPaymentAccountId = data.accountId;
      ctx.state.path = "/cartoes/pagar/valor";
    },

    confirmarPagamento: async (ctx) => {
      const { currentCardId, currentInvoiceId, pendingPaymentAccountId, pendingPaymentAmount } = ctx.state.context;
      try {
        await financialClient.payInvoice(ctx.userId, currentCardId, currentInvoiceId, {
          accountId: pendingPaymentAccountId,
          amount: pendingPaymentAmount,
        });
        await ctx.reply(`✅ *Pagamento registrado!*\n\nR$ ${formatMoney(pendingPaymentAmount)} debitados da conta.`);
        ctx.state.context.pendingPaymentAccountId = null;
        ctx.state.context.pendingPaymentAmount = null;
        ctx.state.context.currentInvoiceId = null;
        ctx.state.context.currentInvoiceTotal = null;
        ctx.state.path = "/cartoes";
      } catch (e) {
        logger.error("[financialFlow] confirmarPagamento error:", e.message);
        await ctx.reply("❌ Erro ao registrar pagamento. Tente novamente.");
        return { noRender: true };
      }
    },
  },
});

module.exports = financialFlow;
module.exports.parseAmount = parseAmount;
