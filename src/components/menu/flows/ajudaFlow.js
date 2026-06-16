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
    if (rest.length <= maxLen) {
      parts.push(rest);
      break;
    }
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

/** Copy alinhada ao plano em flow_ajuda_help (não editar o .plan aqui). */
const COPY = {
  rootTitle: "Ajuda DogBot - o que quer saber?",

  primeirosPassos: `Use /cadastro aqui no privado pra começar a usar as funções.

Use tudo com bom senso. Spam, abuso de comandos ou comportamento que atrapalhe outras pessoas pode gerar restrições temporárias ou bloqueio de funções.

Pra ver esse menu de novo, envie /ajuda.`,

  spotifyIntro: `Atenção: o uso depende de uma conta Spotify Premium. Essa limitação é do Spotify, não do sistema.

Escolha o que quer ver a seguir.`,

  spotifyConectar: `Envie /conectar aqui no privado depois do cadastro.

Será enviado um link de autenticação, basta entrar com a conta Spotify.

Se quiser trocar de conta, ou caso algum erro ocorra, envie /conectar novamente.`,

  spotifyComandos: `/playlist + id da playlist
Envie o comando pra definir uma playlist em um grupo que o bot também esteja. A playlist precisa ser colaborativa.

/nota
Visualize ou registre a nota da música que está ouvindo (ex.: /nota ou /nota 8.5).

/tocando
Mostrarei o que está sendo ouvido no momento (também /np, /nowplaying).

/todos
Mostrarei o que cada pessoa no grupo está ouvindo em tempo real.

/voto
Iniciarei uma votação pra adicionar a música atual na playlist do grupo (se tiver uma definida).

/skip
Abrirei votação pra pular a música da Jam.

/stats, /estatisticas ou /resumo
Abrirei o menu de estatísticas por período.

/jam e /sair
Com /jam, entre ou crie uma sessão.
Com /sair, saia ou feche a sessão se for o host.`,

  spotifyMenu: `Envie /spotify ou /sp para abrir o menu com atalhos para os comandos.

Em grupo, pode ser necessário que a conta esteja ligada.

Sem Premium ou sem conexão ativa, algumas funções não ficam disponíveis.`,

  rotinas: `Envie /rotina (ou /rotinas, /habito) no chat que quiser, grupo ou privado.

Abrirei o menu de rotinas e lembretes no próprio chat.

Crie rotinas, defina repetição e, em grupo, haverá suporte pra organização de participantes quando fizer sentido.

O fluxo usa enquetes, basta seguir as opções.

Se a sessão expirar, envie /rotina novamente.`,

  listas: `Envie /listas (ou /lista).

Abrirei o gestor de listas (criação / edição / visualização).

Ah! Há dois tipos de listas, privadas (criadas no privado) e colaborativas (criadas em grupos)

A sua visualização será limitada dessa forma, em grupos só serão visualizadas listas criadas naquele grupo, assim como listas privadas só serão exibidas aqui no privado

/filme
Busque por nome ou ID TMDb; mostrarei um cartão com opções. Exemplo: /filme Interestelar

/livro
Busque por nome, ISBN ou ID; sem argumentos, explico os formatos aceites. Exemplo: /livro Crepusculo`,

  fitness: `*Ativar treinos (admin)*
Em grupo, envie /ativartreinos. Ativarei ranking e registro se houver permissão.

*Registar treino*
Envie /treinei ou escreva "treinei" e me mencione num grupo que está com registro de treinos ativado.

*Meta anual*
Envie /meta também no privado para definir sua meta.

Nos grupos, poderão ser exibidos ranking e troféus conforme configuração.`,

  copa: `O bot integra com a Copa do Mundo 2026 para palpites, resultados e ranking.

*Principais funções:*
• Palpitar no placar de cada jogo _(no privado)_
• Ver próximos jogos e tabela de grupos
• Ranking de palpites do grupo
• Bolão interno do grupo
• Notificações de gols e resultados em tempo real

*Para começar:*
Envie */copa* no grupo para ver o menu completo.
Palpites são feitos no privado com */palpite*.`,

  cartola: `O Cartola FC é um fantasy de futebol da Globo. O bot integra com a API oficial para trazer dados da sua equipe durante as rodadas.

*Principais funções:*
• Ver escalação e pontuação do seu time
• Ver scouts (eventos) dos seus atletas em tempo real
• Parcial e ranking do grupo
• Ranking da liga vinculada ao grupo
• Notificações automáticas de gols, assistências, cartões e mais

*Para começar:*
1. Envie */cartola* no privado
2. Vá em ⚙️ Configurações → 🔗 Vincular meu time
3. Cole o ID ou URL do seu time no Cartola FC`,

  exitMsg: "Se precisar, envie /ajuda novamente.",
};

function navPadrao() {
  return [
    { label: "Voltar ao menu da ajuda", action: "goto", target: "/" },
    { label: "Fechar ajuda", action: "exec", handler: "exitHelp" },
  ];
}

function navSpotifyLeaf() {
  return [
    { label: "Voltar aos tópicos Spotify", action: "goto", target: "/spotify" },
    { label: "Voltar ao menu da ajuda", action: "goto", target: "/" },
    { label: "Fechar ajuda", action: "exec", handler: "exitHelp" },
  ];
}

const ajudaFlow = createFlow("ajuda", {
  root: {
    dynamic: true,
    options: [],
    handler: async () => {
      return {
        title: COPY.rootTitle,
        options: [
          {
            label: "Primeiros passos",
            action: "goto",
            target: "/primeiros-passos",
          },
          { label: "Spotify", action: "goto", target: "/spotify" },
          { label: "⚽ Cartola FC", action: "goto", target: "/cartola" },
          { label: "🏆 Copa do Mundo", action: "goto", target: "/copa" },
          { label: "Rotinas", action: "goto", target: "/rotinas" },
          { label: "Listas e filmes/livros", action: "goto", target: "/listas" },
          { label: "Fitness (treinos)", action: "goto", target: "/fitness" },
          { label: "Fechar ajuda", action: "exec", handler: "exitHelp" },
        ],
      };
    },
  },

  "/primeiros-passos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.primeirosPassos);
      return { title: "Continuar?", options: navPadrao() };
    },
  },

  "/spotify": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.spotifyIntro);
      return {
        title: "Spotify — o que quer ver?",
        options: [
          { label: "Conectar conta", action: "goto", target: "/spotify/conectar" },
          {
            label: "Comandos únicos",
            action: "goto",
            target: "/spotify/comandos",
          },
          { label: "Menu", action: "goto", target: "/spotify/menu" },
          { label: "Voltar", action: "goto", target: "/" },
        ],
      };
    },
  },

  "/spotify/conectar": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.spotifyConectar);
      return { title: "Continuar?", options: navSpotifyLeaf() };
    },
  },

  "/spotify/comandos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.spotifyComandos);
      return { title: "Continuar?", options: navSpotifyLeaf() };
    },
  },

  "/spotify/menu": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.spotifyMenu);
      return { title: "Continuar?", options: navSpotifyLeaf() };
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
          { label: "📋 Comandos", action: "goto", target: "/copa/comandos" },
          { label: "Voltar", action: "goto", target: "/" },
        ],
      };
    },
  },

  "/copa/palpites": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, [
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
        "Os palpites são *privados* — o grupo só vê após o jogo começar.",
        "Prazo: até o apito inicial de cada partida.",
      ].join("\n"));
      return {
        title: "Continuar?",
        options: [
          { label: "Voltar à Copa", action: "goto", target: "/copa" },
          { label: "Voltar ao menu da ajuda", action: "goto", target: "/" },
          { label: "Fechar ajuda", action: "exec", handler: "exitHelp" },
        ],
      };
    },
  },

  "/copa/comandos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, [
        "📋 *Comandos da Copa do Mundo*",
        "",
        "*/copa* — Abre o menu principal",
        "*/palpite* — Fazer palpites _(no privado)_",
        "*/proxjogo* — Próximos 5 jogos",
        "*/jogoshoje* — Jogos do dia",
        "*/tabela grupo A* — Classificação do grupo (A–L)",
        "*/placar* — Ranking de palpites do grupo",
        "*/bolao* — Gerenciar bolão do grupo _(admin)_",
      ].join("\n"));
      return {
        title: "Continuar?",
        options: [
          { label: "Voltar à Copa", action: "goto", target: "/copa" },
          { label: "Voltar ao menu da ajuda", action: "goto", target: "/" },
          { label: "Fechar ajuda", action: "exec", handler: "exitHelp" },
        ],
      };
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
          { label: "📋 Comandos", action: "goto", target: "/cartola/comandos" },
          { label: "Voltar", action: "goto", target: "/" },
        ],
      };
    },
  },

  "/cartola/vincular": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, [
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
      ].join("\n"));
      return {
        title: "Continuar?",
        options: [
          { label: "Voltar ao Cartola FC", action: "goto", target: "/cartola" },
          { label: "Voltar ao menu da ajuda", action: "goto", target: "/" },
          { label: "Fechar ajuda", action: "exec", handler: "exitHelp" },
        ],
      };
    },
  },

  "/cartola/comandos": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, [
        "📋 *Comandos do Cartola FC*",
        "",
        "*/cartola* — Abre o menu principal",
        "*/scout* — Scouts do seu próprio time",
        "*/scout @usuario* — Scouts do time de alguém do grupo",
      ].join("\n"));
      return {
        title: "Continuar?",
        options: [
          { label: "Voltar ao Cartola FC", action: "goto", target: "/cartola" },
          { label: "Voltar ao menu da ajuda", action: "goto", target: "/" },
          { label: "Fechar ajuda", action: "exec", handler: "exitHelp" },
        ],
      };
    },
  },

  "/rotinas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.rotinas);
      return { title: "Continuar?", options: navPadrao() };
    },
  },

  "/listas": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.listas);
      return { title: "Continuar?", options: navPadrao() };
    },
  },

  "/fitness": {
    dynamic: true,
    options: [],
    handler: async (ctx) => {
      await replyLong(ctx, COPY.fitness);
      return { title: "Continuar?", options: navPadrao() };
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
