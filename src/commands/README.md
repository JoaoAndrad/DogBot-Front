# Pasta `commands`

Comandos do bot são carregados em startup por `index.js` (varredura recursiva de `*.js`, exceto `index.js`). Cada módulo exporta pelo menos `name`, `description` e `async execute(ctx)`.

## Uso

```js
const commands = require('./src/commands');
commands.loadCommands();
console.log(commands.allCommands().map((c) => c.name));
```

`ctx` é um objeto flexível da pipeline (ex.: `{ message, reply, sender, client, services }`).

## Organização

| Pasta        | Conteúdo |
| ------------ | -------- |
| `media/`     | Filmes, séries, livros, listas e consumo de conteúdo |
| `workout/`   | Treinos, metas e ativação de treinos |
| `bot/`       | Operação do bot: menu, cadastro, ping, status, notificações, estatísticas |
| `utilities/` | Ferramentas transversais (ex.: rotinas/hábitos) |
| `social/`    | Interações sociais (confissões, contestações) |
| `polls/`     | Enquetes e resultados |
| `spotify/`   | Integração Spotify (inclui o comando genérico `spotify.js`) |
| `life360/`   | Integração Life360 |

Novos comandos devem ir para a pasta que melhor descreve o domínio; evitar uma pasta genérica tipo `misc`.

## Árvore (resumo)

```
commands/
  index.js
  README.md
  bot/
  life360/
  media/
  polls/
  social/
  spotify/
  utilities/
  workout/
```

Dentro de cada pasta há um ou mais ficheiros `*.js` com um comando cada (ou handlers auxiliares nomeados de forma clara, ex. `pollHandlers.js` em `spotify/`).

## Exemplos

- `bot/ping.js` — comando simples de teste
- `spotify/play.js` — integração Spotify
