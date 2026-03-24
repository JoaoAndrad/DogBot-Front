/**
 * list-creation flow: tipo (filmes/livros) → nome → createList
 */

const conversationState = require("../services/conversationState");
const listClient = require("../services/listClient");
const logger = require("../utils/logger");

function listKindIcon(kind) {
  return kind === "book" ? "📖" : "📽️";
}

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

  // Step 0: resposta = filmes ou livros
  if (step === 0) {
    const kind = parseListKind(body);
    if (!kind) {
      return reply(
        "❌ Responda só *filmes* ou *livros*.\n\n" +
          "Qual tipo de lista você quer criar?",
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

  // Step 1: nome da lista
  if (step === 1) {
    const listName = String(body || "").trim();
    const listKind = data?.listKind === "book" ? "book" : "movie";

    if (listName.length < 1) {
      return reply("❌ O nome da lista não pode estar vazio!");
    }

    if (listName.length > 50) {
      return reply("❌ O nome da lista deve ter no máximo 50 caracteres.");
    }

    try {
      const groupChatId = context?.isGroup ? context?.from : null;
      const newList = await listClient.createList(userId, {
        title: listName,
        groupChatId,
        listKind,
      });

      if (!newList) {
        conversationState.clearState(userId);
        return reply(
          '❌ Erro ao criar lista. Abra /listas e toque em "Criar nova lista" novamente',
        );
      }

      conversationState.clearState(userId);

      const filmTip =
        listKind === "movie"
          ? "• Use `/filme` para buscar e adicionar filmes\n"
          : "";
      const bookTip =
        listKind === "book"
          ? "• Use `/livro` para buscar e adicionar livros\n"
          : "";

      return reply(
        `✅ *Lista criada com sucesso!*\n\n` +
          `${listKindIcon(listKind)} ${newList.title}\n\n` +
          `${filmTip}${bookTip}` +
          `• Use \`/listas\` para gerenciar`,
      );
    } catch (err) {
      logger.error("[ListFlow] Erro ao criar lista:", err.message);
      conversationState.clearState(userId);
      return reply(
        `❌ Erro ao criar lista: ${err.message}\n\n` +
          'Abra /listas e toque em "Criar nova lista" novamente',
      );
    }
  }
}

module.exports = { handleListFlow };
