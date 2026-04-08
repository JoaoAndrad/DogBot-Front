/**
 * JIDs de participantes de grupo (whatsapp-web.js).
 * A forma de `participant.id` varia (objeto com _serialized ou string).
 */

function serializedParticipantId(participant) {
  if (!participant || participant.id == null) return null;
  const id = participant.id;
  if (typeof id === "string") return id;
  if (id._serialized) return id._serialized;
  // Wid sem _serialized populado (comum em alguns grupos / versões do wwebjs)
  if (id.user) {
    const server = id.server || "c.us";
    return `${id.user}@${server}`;
  }
  return null;
}

/**
 * Lista única de JIDs a partir de `chat.participants`.
 */
function memberIdsFromGroupChat(chat) {
  if (!chat || !Array.isArray(chat.participants)) return [];
  const seen = new Set();
  const out = [];
  for (const p of chat.participants) {
    const sid = serializedParticipantId(p);
    if (sid && !seen.has(sid)) {
      seen.add(sid);
      out.push(sid);
    }
  }
  return out;
}

/**
 * Igual ao fluxo de /todos: participantes do grupo, com fallback quando a lista vem curta.
 * Em alguns casos `message.getChat()` devolve poucos participantes; `getChatById` costuma ser completo.
 *
 * @param {import("whatsapp-web.js").Client} client
 * @param {import("whatsapp-web.js").Message} message
 * @param {string} chatId - JID do grupo (@g.us)
 */
async function resolveGroupMemberIds(client, message, chatId) {
  const merged = new Set();

  try {
    const chat = await message.getChat();
    for (const id of memberIdsFromGroupChat(chat)) merged.add(id);
  } catch (_) {
    /* ignore */
  }

  if (chatId && String(chatId).endsWith("@g.us") && client && typeof client.getChatById === "function") {
    try {
      const chatById = await client.getChatById(chatId);
      for (const id of memberIdsFromGroupChat(chatById)) merged.add(id);
    } catch (_) {
      /* ignore */
    }
  }

  return [...merged];
}

module.exports = {
  serializedParticipantId,
  memberIdsFromGroupChat,
  resolveGroupMemberIds,
};
