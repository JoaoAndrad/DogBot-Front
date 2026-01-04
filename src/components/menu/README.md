# Menu System - Interactive Poll Navigation

Sistema de navegação interativa usando polls do WhatsApp como interface. Permite criar menus hierárquicos onde usuários navegam clicando em opções de enquetes.

## Arquitetura

```
frontend/src/components/menu/
├── index.js           # Exports principais
├── flowManager.js     # Engine de navegação (singleton)
├── flowBuilder.js     # DSL para definir flows
├── storage.js         # Client HTTP para backend APIs
└── flows/             # Definições de flows específicos
    └── testFlow.js    # Flow de exemplo/teste
```

## Como Usar

### 1. Criar um Flow

```javascript
const { createFlow } = require("./components/menu/flowBuilder");

const myFlow = createFlow("myflow", {
  root: {
    title: "🎯 Menu Principal",
    options: [
      { label: "📝 Opção 1", action: "goto", target: "/sub1" },
      { label: "✅ Executar", action: "exec", handler: "doSomething" },
    ],
  },

  "/sub1": {
    title: "📝 Submenu",
    options: [{ label: "⬅️ Voltar", action: "back" }],
  },

  handlers: {
    doSomething: async (ctx) => {
      await ctx.reply("✅ Feito!");
      return { end: true };
    },
  },
});
```

### 2. Registrar o Flow

```javascript
const flowManager = require("./components/menu/flowManager");
flowManager.registerFlow(myFlow);
```

### 3. Iniciar Flow em Comando

```javascript
// src/commands/mycommand.js
module.exports = {
  name: "mycommand",
  async execute(context) {
    const { client, msg } = context;
    const userId = msg.author || msg.from;
    const chatId = msg.from;

    await flowManager.startFlow(client, chatId, userId, "myflow");
  },
};
```

## Tipos de Ação

### `goto` - Navegar para outro nó

```javascript
{ label: 'Ir para X', action: 'goto', target: '/caminho/x' }
```

### `back` - Voltar para nó anterior

```javascript
{ label: '⬅️ Voltar', action: 'back' }
```

### `exec` - Executar handler

```javascript
{ label: 'Fazer algo', action: 'exec', handler: 'handlerName', data: { key: 'value' } }
```

## Handlers

Handlers recebem contexto rico:

```javascript
handlers: {
  myHandler: async (ctx, data) => {
    // ctx.userId - ID do usuário
    // ctx.chatId - ID do chat
    // ctx.client - WhatsApp client
    // ctx.reply(text) - Envia mensagem
    // ctx.state - Estado atual do menu
    // ctx.flowId - ID do flow
    // data - Dados do option.data

    await ctx.reply('Processando...');

    // Retornar { end: true } encerra o flow
    // Retornar { end: false } mantém navegação ativa
    return { end: false };
  },
}
```

## Nós Dinâmicos

Options geradas em runtime:

```javascript
'/dynamic': {
  title: 'Opções Dinâmicas',
  dynamic: true,
  handler: async (ctx) => {
    // Buscar dados do backend
    const items = await fetchItems(ctx.userId);

    return {
      options: items.map(item => ({
        label: item.name,
        action: 'exec',
        handler: 'selectItem',
        data: { itemId: item.id }
      })).concat([
        { label: '⬅️ Voltar', action: 'back' }
      ])
    };
  },
}
```

## Estado Persistente

Estado é salvo automaticamente no backend:

- `path` - Nó atual
- `history` - Histórico de navegação (para back)
- `context` - Dados customizados
- `expiresAt` - TTL (padrão: 30 minutos)

## Navegação em Grupos

- Cada usuário tem seu próprio estado (por `userId + flowId`)
- Votos de outros usuários são ignorados
- Poll é enviada no grupo, mas apenas o iniciador pode navegar

## Exemplo Completo

Ver [flows/testFlow.js](flows/testFlow.js) para exemplo funcional com:

- Navegação hierárquica
- Handlers síncronos e assíncronos
- Opções dinâmicas
- Ações com dados customizados
- Voltar/sair

## Testar

```bash
# No WhatsApp, envie:
/menu

# Clique nas opções da poll para navegar
```

## Backend

Endpoints usados automaticamente:

- `POST /api/menu/state` - Salvar estado
- `GET /api/menu/state/:userId/:flowId` - Buscar estado
- `DELETE /api/menu/state/:userId/:flowId` - Deletar estado

Headers necessários:

- `X-Internal-Secret: ${POLL_SHARED_SECRET}`
