/**
 * Flow /financeiro — assistente financeiro pessoal.
 *
 * Primeira vez: onboarding + OAuth Google
 * Usuário vinculado: menu principal (Extrato, Contas, Categorias, Orçamentos, Config, Dúvidas)
 */
const { createFlow } = require("../flowBuilder");
const financialClient = require("../../../services/financialClient");
const logger = require("../../../utils/logger");

// ─── Helpers ────────────────────────────────────────────────────────────────

async function checkLinked(userId) {
  try {
    const res = await financialClient.checkAuthStatus(userId);
    return !!(res && res.linked);
  } catch (e) {
    logger.warn("[financialFlow] checkAuthStatus error:", e.message);
    return false;
  }
}

function pollAuthStatus(client, chatId, userId, maxAttempts = 36, intervalMs = 10000) {
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts++;
    try {
      const linked = await checkLinked(userId);
      if (linked) {
        clearInterval(timer);
        await client.sendMessage(
          chatId,
          "✅ *Conta vinculada com sucesso!*\n\nSeu cofre financeiro foi criado e as categorias padrão foram configuradas.\n\nEnvie */financeiro* para acessar o menu."
        );
      }
    } catch (e) {
      logger.warn("[financialFlow] poll error:", e.message);
    }
    if (attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, intervalMs);
}

// ─── Flow definition ────────────────────────────────────────────────────────

const financialFlow = createFlow("financeiro", {
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

  // ── Onboarding / OAuth ──────────────────────────────────────────────────

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

  // ── Extrato ─────────────────────────────────────────────────────────────

  "/extrato": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      return {
        title: "📋 Extrato — período",
        options: [
          { label: "Este mês", action: "exec", handler: "extratoMes", data: { period: "current" } },
          { label: "Mês anterior", action: "exec", handler: "extratoMes", data: { period: "last" } },
          { label: "↩️ Voltar", action: "back" },
        ],
      };
    },
  },

  // ── Contas ──────────────────────────────────────────────────────────────

  "/contas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      return {
        title: "🏦 Contas bancárias",
        options: [
          { label: "Ver contas", action: "exec", handler: "listarContas" },
          { label: "Adicionar conta", action: "exec", handler: "adicionarConta" },
          { label: "↩️ Voltar", action: "back" },
        ],
      };
    },
  },

  // ── Categorias ──────────────────────────────────────────────────────────

  "/categorias": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      return {
        title: "🏷️ Categorias",
        options: [
          { label: "Ver categorias", action: "exec", handler: "listarCategorias" },
          { label: "Criar categoria", action: "exec", handler: "criarCategoria" },
          { label: "↩️ Voltar", action: "back" },
        ],
      };
    },
  },

  // ── Orçamentos ──────────────────────────────────────────────────────────

  "/orcamentos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      return {
        title: "📊 Orçamentos",
        options: [
          { label: "Ver orçamentos", action: "exec", handler: "listarOrcamentos" },
          { label: "Criar orçamento", action: "exec", handler: "criarOrcamento" },
          { label: "↩️ Voltar", action: "back" },
        ],
      };
    },
  },

  // ── Configurações ───────────────────────────────────────────────────────

  "/config": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      return {
        title: "⚙️ Configurações",
        options: [
          { label: "Horário de notificações", action: "exec", handler: "configNotifHour" },
          { label: "↩️ Voltar", action: "back" },
        ],
      };
    },
  },

  // ── Dúvidas ─────────────────────────────────────────────────────────────

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
        "Use o menu 🏦 Contas ou envie */financeiro*.\n\n" +
        "*Como editar ou excluir?*\n" +
        "Abra o extrato e selecione a transação.\n\n" +
        "*Os dados são seguros?*\n" +
        "Sim. Tudo é criptografado com sua chave pessoal Google. Nem o desenvolvedor tem acesso.\n\n" +
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

  // ── Handlers ────────────────────────────────────────────────────────────

  handlers: {
    close: async (ctx) => {
      await ctx.reply("💰 Assistente financeiro fechado. Até logo!");
      return { end: true };
    },

    startOAuth: async (ctx) => {
      try {
        const result = await financialClient.startAuth(ctx.userId);
        if (!result || !result.authUrl) {
          await ctx.reply("❌ Não foi possível gerar o link de autenticação. Tente novamente.");
          return { noRender: true };
        }

        await ctx.reply(
          "🔐 *Autenticação Google*\n\n" +
          "Clique no link abaixo para conectar sua conta Google:\n\n" +
          result.authUrl + "\n\n" +
          "⏱️ O link expira em *15 minutos*.\n" +
          "Após autorizar, você receberá uma confirmação aqui."
        );

        // Poll in background until linked or timeout
        pollAuthStatus(ctx.client, ctx.chatId, ctx.userId);

        return { end: true };
      } catch (e) {
        logger.error("[financialFlow] startOAuth error:", e.message);
        await ctx.reply("❌ Erro ao gerar link. Tente novamente em alguns instantes.");
        return { noRender: true };
      }
    },

    // Stubs — will be implemented in subsequent phases
    extratoMes: async (ctx, data) => {
      await ctx.reply("📋 Funcionalidade em desenvolvimento. Disponível em breve!");
      return { noRender: true };
    },

    listarContas: async (ctx) => {
      await ctx.reply("🏦 Funcionalidade em desenvolvimento. Disponível em breve!");
      return { noRender: true };
    },

    adicionarConta: async (ctx) => {
      await ctx.reply("🏦 Funcionalidade em desenvolvimento. Disponível em breve!");
      return { noRender: true };
    },

    listarCategorias: async (ctx) => {
      await ctx.reply("🏷️ Funcionalidade em desenvolvimento. Disponível em breve!");
      return { noRender: true };
    },

    criarCategoria: async (ctx) => {
      await ctx.reply("🏷️ Funcionalidade em desenvolvimento. Disponível em breve!");
      return { noRender: true };
    },

    listarOrcamentos: async (ctx) => {
      await ctx.reply("📊 Funcionalidade em desenvolvimento. Disponível em breve!");
      return { noRender: true };
    },

    criarOrcamento: async (ctx) => {
      await ctx.reply("📊 Funcionalidade em desenvolvimento. Disponível em breve!");
      return { noRender: true };
    },

    configNotifHour: async (ctx) => {
      await ctx.reply("⚙️ Funcionalidade em desenvolvimento. Disponível em breve!");
      return { noRender: true };
    },
  },
});

module.exports = financialFlow;
