/**
 * list-creation flow: tipo (filmes/livros) → nome → createList
 */

const conversationState = require("../services/conversationState");
const flowManager = require("../components/menu/flowManager");
const logger = require("../utils/logger");

function parseListKind(body) {
  const b = String(body || "")
    .trim()
    .toLowerCase();
  if (
    b === "filmes" ||
    b === "filme" ||
    b === "movie" ||
    b === "movies" ||
    b === "cinema"
  ) {
    return "movie";
  }
  if (
    b === "livros" ||
    b === "livro" ||
    b === "book" ||
    b === "books" ||
    b === "leitura"
  ) {
    return "book";
  }
  return null;
}

async function handleListFlow(userId, body, state, reply, context) {
  const { step, data } = state;

  logger.info(`[ListFlow] step=${step}, body="${body}" userId=${userId}`);

  // Step 0: legado (texto); fluxo novo usa enquete em /listas
  if (step === 0) {
    const kind = parseListKind(body);
    if (!kind) {
      return reply(
        "❌ Abra */listas*, toque em *Criar nova lista* e escolha na enquete *Filmes* ou *Livros*.\n\n" +
          "Ou responda aqui só *filmes* ou *livros*.",
      );
    }
    conversationState.updateData(userId, { listKind: kind });
    conversationState.nextStep(userId);
    const hint =
      kind === "book"
        ? "_Ex.: Leituras 2025, Ficção científica_"
        : "_Ex.: Clássicos, Para assistir no fim de semana_";
    return reply(
      `✅ Lista de *${kind === "book" ? "livros" : "filmes"}*.\n\n` +
        `Digite o *nome* da lista (máx. 50 caracteres):\n\n` +
        hint,
    );
  }

  // Step 1: nome da lista → enquete de confirmação no fluxo /listas
  if (step === 1) {
    const listName = String(body || "").trim();
    const listKind = data?.listKind === "book" ? "book" : "movie";

    if (listName.length < 1) {
      return reply("❌ O nome da lista não pode estar vazio!");
    }

    if (listName.length > 50) {
      return reply("❌ O nome da lista deve ter no máximo 50 caracteres.");
    }

    const chatId = context?.chatId || context?.from;
    if (!context?.client || !chatId) {
      logger.error("[ListFlow] Sem client/chatId para abrir enquete de confirmação");
      return reply(
        "❌ Não foi possível abrir a confirmação. Tente */listas* de novo.",
      );
    }

    try {
      await flowManager.startFlow(context.client, chatId, userId, "lists", {
        initialContext: {
          createListConfirm: {
            listKind,
            listName,
            chatId,
            isGroup: !!context.isGroup,
          },
        },
        initialPath: "/create-list-confirm",
        initialHistory: [],
      });
      conversationState.clearState(userId);
      return reply("👇 Confirme na enquete abaixo.");
    } catch (err) {
      logger.error("[ListFlow] Erro ao abrir confirmação:", err.message);
      return reply(
        `❌ Erro ao abrir confirmação: ${err.message}\n\n` +
          "Tente */listas* → *Criar nova lista*.",
      );
    }
  }
}

module.exports = { handleListFlow };
