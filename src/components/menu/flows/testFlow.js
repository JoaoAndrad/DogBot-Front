const { createFlow } = require("../flowBuilder");

/**
 * Test Flow - Simple menu for testing navigation
 */
const testFlow = createFlow("test", {
  root: {
    title: "🧪 Menu de Teste",
    options: [
      { label: "📝 Submenu 1", action: "goto", target: "/submenu1" },
      { label: "🎯 Submenu 2", action: "goto", target: "/submenu2" },
      { label: "✅ Executar Ação", action: "exec", handler: "executeAction" },
      { label: "❌ Sair", action: "exec", handler: "exit" },
    ],
  },

  "/submenu1": {
    title: "📝 Submenu 1",
    options: [
      { label: "🔵 Opção A", action: "exec", handler: "optionA" },
      { label: "🟢 Opção B", action: "exec", handler: "optionB" },
      { label: "⬅️ Voltar", action: "back" },
    ],
  },

  "/submenu2": {
    title: "🎯 Submenu 2",
    options: [
      { label: "📊 Ver Estado", action: "exec", handler: "showState" },
      { label: "🔄 Submenu Dinâmico", action: "goto", target: "/dynamic" },
      { label: "⬅️ Voltar", action: "back" },
    ],
  },

  "/dynamic": {
    title: "🔄 Opções Dinâmicas",
    dynamic: true,
    handler: async (ctx) => {
      // Simulate dynamic options based on current state
      const now = new Date();
      const hour = now.getHours();

      return {
        options: [
          {
            label: `⏰ Hora atual: ${hour}h`,
            action: "exec",
            handler: "showTime",
            data: { hour },
          },
          {
            label: "🎲 Número Aleatório",
            action: "exec",
            handler: "randomNumber",
          },
          { label: "⬅️ Voltar", action: "back" },
        ],
      };
    },
  },

  handlers: {
    executeAction: async (ctx) => {
      await ctx.reply("✅ Ação executada com sucesso!");
      // Don't end flow, allow continuing navigation
      return { end: false };
    },

    exit: async (ctx) => {
      await ctx.reply("👋 Saindo do menu. Até logo!");
      return { end: true };
    },

    optionA: async (ctx) => {
      await ctx.reply("🔵 Você escolheu a Opção A!");
      return { end: false };
    },

    optionB: async (ctx) => {
      await ctx.reply("🟢 Você escolheu a Opção B!");
      return { end: false };
    },

    showState: async (ctx) => {
      const state = ctx.state || {};
      await ctx.reply(
        `📊 Estado atual:\n` +
          `• Path: ${state.path || "N/A"}\n` +
          `• Histórico: ${JSON.stringify(state.history || [])}\n` +
          `• Contexto: ${JSON.stringify(state.context || {})}`
      );
      return { end: false };
    },

    showTime: async (ctx, data) => {
      const hour = data?.hour || new Date().getHours();
      let greeting = "";

      if (hour < 12) greeting = "Bom dia!";
      else if (hour < 18) greeting = "Boa tarde!";
      else greeting = "Boa noite!";

      await ctx.reply(`⏰ ${greeting} São ${hour}h agora.`);
      return { end: false };
    },

    randomNumber: async (ctx) => {
      const num = Math.floor(Math.random() * 100) + 1;
      await ctx.reply(`🎲 Número sorteado: ${num}`);
      return { end: false };
    },
  },
});

module.exports = testFlow;
