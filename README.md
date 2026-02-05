# DogBot — Frontend (WhatsApp)

Este repositório contém o cliente WhatsApp do DogBot, implementado com `whatsapp-web.js`. O frontend atua como o cliente de mensagens: mantém sessão, processa comandos, constrói e envia enquetes/polls, gerencia interações com usuários e delega operações de negócio ao backend via API.

Visão técnica (resumo)

- Plataforma: Node.js com `whatsapp-web.js` para interação com o WhatsApp Web.
- Organização: código dividido entre inicialização da sessão, comandos, handlers, serviços (integração com backend/Spotify) e armazenamento local (persistência de sessão e caches).
- Sessão: a autenticação e sessão do WhatsApp são mantidas em diretórios locais (persistência de sessão para evitar novo QR a cada reinício).

Execução (resumo)

1. Instalar dependências e gerar artefatos necessários:

```bash
npm install
```

2. Rodar em modo desenvolvimento (com recarga automática):

```bash
npm run dev
```

3. Rodar em produção:

```bash
npm start
```

Observações operacionais

- A aplicação persiste credenciais e cache localmente (pasta `.wwebjs_auth` e `.wwebjs_cache`). Garanta cópia/backup seguro desses dados quando necessário.
- O frontend comunica-se com o backend via endpoints internos; ambos devem estar configurados corretamente no ambiente de execução.
- Monitore logs e arquivos de sessão ao operar o serviço em ambientes com alta disponibilidade.
