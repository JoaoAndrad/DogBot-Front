/**
 * Flow /ajuda — menu de ajuda (só faz sentido no privado; o comando valida).
 */

const { createFlow } = require("../flowBuilder");

function chunkMessage(text, maxLen = 3600) {
  const s = String(text || "").trim();
  if (s.length <= maxLen) return [s];
  const parts = [];
  let rest = s;
  while (rest.length) {
    if (rest.length <= maxLen) { parts.push(rest); break; }
    let cut = rest.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return parts;
}

async function replyLong(ctx, text) {
  for (const chunk of chunkMessage(text)) {
    if (chunk) await ctx.reply(chunk);
  }
}

const COPY = {
  rootTitle: "🐾 DogBot — Central de ajuda",

  primeirosPassos: [
    "🚀 *Primeiros passos*",
    "",
    "Envie */cadastro* aqui no privado para começar a usar as funções.",
    "",
    "Use tudo com bom senso. Spam, abuso de comandos ou comportamento que atrapalhe outras pessoas pode gerar restrições ou bloqueio de funções.",
    "",
    "Pra ver esse menu novamente, envie */ajuda*.",
  ].join("\n"),

  spotifyIntro: [
    "🎵 *Spotify*",
    "",
    "Atenção: o uso depende de uma conta *Spotify Premium*. Essa limitação é do Spotify, não minha.",
    "",
    "Escolha o que quer ver a seguir.",
  ].join("\n"),

  spotifyConectar: [
    "🔗 *Conectar conta Spotify*",
    "",
    "Envie */conectar* aqui no privado após o cadastro.",
    "",
    "Enviarei um link de autenticação — basta entrar com a conta Spotify.",
    "",
    "Se quiser trocar de conta ou ocorrer algum erro, envie */conectar* novamente.",
  ].join("\n"),

  spotifyComandos: [
    "🎵 *Comandos do Spotify*",
    "",
    "*/playlist* + id — Define a playlist de um grupo (precisa ser colaborativa)",
    "*/nota* — Veja ou registre a nota da música atual (ex: */nota 8.5*)",
    "*/tocando* — Mostra o que você está ouvindo agora (também */np*, */nowplaying*)",
    "*/todos* — Mostra o que cada pessoa no grupo está ouvindo",
    "*/voto* — Inicia votação pra adicionar a música atual na playlist do grupo",
    "*/skip* — Inicia votação pra pular a música da Jam",
    "*/stats* — Abre o menu de estatísticas por período (também */estatisticas*, */resumo*)",
    "*/jam* — Entre ou crie uma sessão",
    "*/sair* — Saia ou feche a sessão se for o host",
  ].join("\n"),

  spotifyMenu: [
    "📋 *Menu Spotify*",
    "",
    "Envie */spotify* ou */sp* para abrir o menu com atalhos para os comandos.",
    "",
    "Em grupo, posso precisar que a conta esteja conectada.",
    "",
    "Sem Premium ou sem conexão ativa, não consigo executar algumas funções.",
  ].join("\n"),

  rotinas: [
    "🔔 *Rotinas e lembretes*",
    "",
    "Envie */rotina* (ou */rotinas*, */habito*) no chat que quiser — grupo ou privado.",
    "",
    "Abrirei o menu de rotinas no próprio chat. Crie rotinas, defina repetição e, em grupos, ofereço suporte para organização de participantes.",
    "",
    "Uso enquetes — basta seguir as opções.",
    "",
    "Se a sessão expirar, envie */rotina* novamente.",
  ].join("\n"),

  listas: [
    "📋 *Listas, filmes e livros*",
    "",
    "*Listas*",
    "Envie */listas* (ou */lista*) para abrir o gestor de listas.",
    "",
    "Tenho dois tipos:",
    "• *Privadas* — criadas aqui no privado, só você vê",
    "• *Colaborativas* — criadas em grupos, visíveis só naquele grupo",
    "",
    "*Filmes*",
    "*/filme* + nome ou ID TMDb — Busco e exibo cartão com opções",
    "Exemplo: */filme Interestelar*",
    "",
    "*Livros*",
    "*/livro* + nome, ISBN ou ID — Sem argumentos, explico os formatos aceitos",
    "Exemplo: */livro Crepúsculo*",
  ].join("\n"),

  fitness: [
    "🏋️ *Fitness e treinos*",
    "",
    "*Ativar treinos (admin)*",
    "Em grupo, envie */ativartreinos*. Ativarei ranking e registro se houver permissão.",
    "",
    "*Registrar treino*",
    "Envie */treinei* ou escreva \"treinei\" e me mencione num grupo com registro ativado.",
    "",
    "*Meta anual*",
    "Envie */meta* aqui no privado para definir sua meta.",
    "",
    "Nos grupos, exibo ranking e troféus conforme configuração.",
  ].join("\n"),

  copa: [
    "🏆 *Copa do Mundo 2026*",
    "",
    "Integro com a Copa do Mundo para palpites, resultados e ranking.",
    "",
    "*Principais funções:*",
    "• Palpitar no placar de cada jogo _(no privado)_",
    "• Ver próximos jogos e tabela de grupos",
    "• Ranking de palpites do grupo",
    "• Bolão interno do grupo",
    "• Notificações de gols e resultados em tempo real",
    "",
    "Envie */copa* no grupo para ver o menu completo.",
    "Palpites são feitos no privado com */palpite*.",
  ].join("\n"),

  copaPalpites: [
    "🎯 *Palpites e pontuação*",
    "",
    "Envie */palpite* no privado para apostar no placar de cada jogo.",
    "",
    "🥇 Placar exato → *3 pts*",
    "✅ Vencedor/empate certo → *1 pt*",
    "➕ Acertou quem avança nos pênaltis → *+1 pt bônus*",
    "",
    "🏆 *Campeão da Copa* → *20 pts*",
    "🦓 *Zebra da Copa* → *10 pts*",
    "⭐ *Craque da Copa* → *8 pts*",
    "",
    "Mantenho os palpites *privados* — o grupo só vê após o jogo começar.",
    "Prazo: até o apito inicial de cada partida.",
  ].join("\n"),

  copaComandos: [
    "📋 *Comandos da Copa do Mundo*",
    "",
    "*/copa* — Abre o menu principal",
    "*/palpite* — Fazer palpites _(no privado)_",
    "*/proxjogo* — Próximos 5 jogos",
    "*/jogoshoje* — Jogos do dia",
    "*/tabela grupo A* — Classificação do grupo (A–L)",
    "*/placar* — Ranking de palpites do grupo",
    "*/bolao* — Gerenciar bolão do grupo _(admin)_",
  ].join("\n"),

  cartola: [
    "⚽ *Cartola FC*",
    "",
    "O Cartola FC é um fantasy de futebol da Globo. Integro com a API oficial para trazer dados da sua equipe durante as rodadas.",
    "",
    "*Principais funções:*",
    "• Ver escalação e pontuação do seu time",
    "• Scouts (eventos) dos seus atletas em tempo real",
    "• Parcial e ranking do grupo",
    "• Ranking da liga vinculada ao grupo",
    "• Notificações automáticas de gols, assistências, cartões e mais",
    "",
    "Envie */cartola* no privado para começar.",
  ].join("\n"),

  cartolaVincular: [
    "🔗 *Como vincular o time*",
    "",
    "1. Abra o Cartola FC e veja a URL do seu time:",
    "   _cartola.globo.com/#!/time/*19513040*_",
    "2. Envie */cartola* aqui no privado",
    "3. Vá em ⚙️ Configurações → 🔗 Vincular meu time",
    "4. Cole o número (ou slug) do time",
    "",
    "Após vincular, use */cartola → 🏠 Meu time* para ver sua escalação.",
    "",
    "_Para vincular uma liga ao grupo, faça o mesmo dentro do grupo:_",
    "_*/cartola* → ⚙️ Configurações → 🏆 Vincular liga_",
  ].join("\n"),

  cartolaComandos: [
    "📋 *Comandos do Cartola FC*",
    "",
    "*/cartola* — Abre o menu principal",
    "*/scout* — Scouts do seu próprio time",
    "*/scout @usuario* — Scouts do time de alguém do grupo",
  ].join("\n"),

  financeiro: [
    "💰 *Assistente Financeiro*",
    "",
    "Controlo suas finanças pelo WhatsApp com segurança total. Seus dados são criptografados com sua chave pessoal.",
    "",
    "*Como abrir:*",
    "Envie */financeiro* aqui no privado e te mostro o menu completo.",
    "",
    "*Registro por texto:*",
    "Basta escrever em linguagem natural:",
    "• \"Gastei 50 reais de uber\"",
    "• \"Recebi 3200 de salário\"",
    "• \"Paguei 800 de aluguel todo dia 5\"",
    "• \"Comprei notebook por 3000 em 12x\"",
    "",
    "*Consultas rápidas (sem abrir o menu):*",
    "• \"Qual meu saldo?\"",
    "• \"Quanto gastei esse mês?\"",
    "• \"Meus agendamentos\"",
    "• \"Como está meu orçamento?\"",
  ].join("\n"),

  financeiroFuncoes: [
    "💰 *Assistente Financeiro — Funções*",
    "",
    "📋 *Extrato* — Mostro o histórico com resumo mensal e paginação",
    "",
    "🏦 *Contas* — Exibo saldo atual e projetado, e faço transferências entre contas",
    "",
    "💳 *Cartões de crédito* — Controlo faturas, pagamentos e lançamentos parcelados",
    "",
    "📅 *Lançamentos futuros* — Agende pagamentos e receitas recorrentes (diário, semanal, mensal). Envio notificações automáticas no horário que preferir.",
    "",
    "🏷️ *Categorias* — Organizo seus gastos com categorias personalizadas",
    "",
    "📊 *Orçamentos* — Defino limites por categoria e aviso em 80% e 100%",
    "",
    "⚙️ *Configurações* — Conta padrão, horário de notificações, desvincular conta Google",
  ].join("\n"),

  exitMsg: "Se precisar, envie /ajuda novamente. 🐾",
};

function navPadrao() {
  return [
    { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
    { label: "✖️ Fechar ajuda", action: "exec", handler: "exitHelp" },
  ];
}

function navSecao(target, label) {
  return [
    { label: `↩️ Voltar — ${label}`, action: "goto", target },
    { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
    { label: "✖️ Fechar ajuda", action: "exec", handler: "exitHelp" },
  ];
}

const ajudaFlow = createFlow("ajuda", {
  root: {
    dynamic: true,
    options: [],
    handler: async () => ({
      title: COPY.rootTitle,
      options: [
        { label: "🚀 Primeiros passos",        action: "goto", target: "/primeiros-passos" },
        { label: "🎵 Spotify",                  action: "goto", target: "/spotify" },
        { label: "⚽ Cartola FC",               action: "goto", target: "/cartola" },
        { label: "🏆 Copa do Mundo",            action: "goto", target: "/copa" },
        { label: "🔔 Rotinas",                  action: "goto", target: "/rotinas" },
        { label: "📋 Listas e filmes/livros",   action: "goto", target: "/listas" },
        { label: "🏋️ Fitness",                 action: "goto", target: "/fitness" },
        { label: "💰 Assistente financeiro",    action: "goto", target: "/financeiro" },
        { label: "✖️ Fechar ajuda",             action: "exec", handler: "exitHelp" },
      ],
    }),
  },

  "/primeiros-passos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.primeirosPassos);
      return { title: "O que mais quer saber?", options: navPadrao() };
    },
  },

  "/spotify": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.spotifyIntro);
      return {
        title: "🎵 Spotify — o que quer ver?",
        options: [
          { label: "🔗 Conectar conta",  action: "goto", target: "/spotify/conectar" },
          { label: "📋 Comandos",        action: "goto", target: "/spotify/comandos" },
          { label: "📲 Menu Spotify",    action: "goto", target: "/spotify/menu" },
          { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
        ],
      };
    },
  },

  "/spotify/conectar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.spotifyConectar);
      return { title: "O que mais quer saber?", options: navSecao("/spotify", "Spotify") };
    },
  },

  "/spotify/comandos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.spotifyComandos);
      return { title: "O que mais quer saber?", options: navSecao("/spotify", "Spotify") };
    },
  },

  "/spotify/menu": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.spotifyMenu);
      return { title: "O que mais quer saber?", options: navSecao("/spotify", "Spotify") };
    },
  },

  "/copa": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.copa);
      return {
        title: "🏆 Copa do Mundo — o que quer ver?",
        options: [
          { label: "🎯 Palpites e pontuação", action: "goto", target: "/copa/palpites" },
          { label: "📋 Comandos",             action: "goto", target: "/copa/comandos" },
          { label: "↩️ Voltar ao menu",       action: "goto", target: "/" },
        ],
      };
    },
  },

  "/copa/palpites": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.copaPalpites);
      return { title: "O que mais quer saber?", options: navSecao("/copa", "Copa do Mundo") };
    },
  },

  "/copa/comandos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.copaComandos);
      return { title: "O que mais quer saber?", options: navSecao("/copa", "Copa do Mundo") };
    },
  },

  "/cartola": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.cartola);
      return {
        title: "⚽ Cartola FC — o que quer ver?",
        options: [
          { label: "🔗 Vincular time", action: "goto", target: "/cartola/vincular" },
          { label: "📋 Comandos",      action: "goto", target: "/cartola/comandos" },
          { label: "↩️ Voltar ao menu", action: "goto", target: "/" },
        ],
      };
    },
  },

  "/cartola/vincular": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.cartolaVincular);
      return { title: "O que mais quer saber?", options: navSecao("/cartola", "Cartola FC") };
    },
  },

  "/cartola/comandos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.cartolaComandos);
      return { title: "O que mais quer saber?", options: navSecao("/cartola", "Cartola FC") };
    },
  },

  "/rotinas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.rotinas);
      return { title: "O que mais quer saber?", options: navPadrao() };
    },
  },

  "/listas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.listas);
      return { title: "O que mais quer saber?", options: navPadrao() };
    },
  },

  "/fitness": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.fitness);
      return { title: "O que mais quer saber?", options: navPadrao() };
    },
  },

  "/financeiro": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.financeiro);
      return {
        title: "💰 Assistente financeiro — o que quer ver?",
        options: [
          { label: "📋 Ver todas as funções", action: "goto", target: "/financeiro/funcoes" },
          { label: "↩️ Voltar ao menu",       action: "goto", target: "/" },
          { label: "✖️ Fechar ajuda",          action: "exec", handler: "exitHelp" },
        ],
      };
    },
  },

  "/financeiro/funcoes": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.financeiroFuncoes);
      return { title: "O que mais quer saber?", options: navSecao("/financeiro", "Assistente financeiro") };
    },
  },

  handlers: {
    exitHelp: async (ctx) => {
      await ctx.reply(COPY.exitMsg);
      return { end: true };
    },
  },
});

module.exports = ajudaFlow;
