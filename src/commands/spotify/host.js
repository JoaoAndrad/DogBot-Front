const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const polls = require("../../components/poll");

module.exports = {
  name: "host",
  aliases: ["anfitriao"],
  description: "Transferir controle da jam para outro ouvinte (apenas host)",

  async execute(ctx) {
    const { message, reply, client } = ctx;
    const msg = message;
    const chatId = msg.from;

    // Check if is group
    const isGroup =
      !!(msg && msg.isGroup) || (chatId && chatId.endsWith("@g.us"));

    if (!isGroup) {
      return reply("⚠️ Este comando só funciona em grupos com jam ativa.");
    }

    try {
      // Get user WhatsApp identifier
      let whatsappId = null;
      try {
        const contact = await msg.getContact();
        if (contact && contact.id && contact.id._serialized) {
          whatsappId = contact.id._serialized;
        }
      } catch (err) {
        whatsappId = msg.author || msg.from;
      }

      logger.info(`[Host] Iniciando transferência no grupo ${chatId}`);

      // Get user info
      const userRes = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(whatsappId)}`,
        null,
        "GET",
      );

      if (!userRes || !userRes.found) {
        return reply(
          "⚠️ Você precisa ter uma conta cadastrada. Envie /cadastro no meu privado.",
        );
      }

      const currentUserId = userRes.userId;

      // Check if user is hosting a jam
      const jamStatusRes = await backendClient.sendToBackend(
        `/api/jam/user/${currentUserId}/status`,
        null,
        "GET",
      );

      if (!jamStatusRes || !jamStatusRes.jam) {
        return reply("⚠️ Você não está em nenhuma jam ativa.");
      }

      const jam = jamStatusRes.jam;
      const role = jamStatusRes.role;

      // Only host can transfer
      if (role !== "host") {
        return reply(
          "⚠️ Apenas o host pode transferir o controle da jam. Você é um ouvinte.",
        );
      }

      // Check if there are any listeners
      const activeListeners =
        jam.listeners?.filter((l) => l.isActive && l.user) || [];

      if (activeListeners.length === 0) {
        return reply(
          "⚠️ Não há ouvintes na sua jam. Você precisa ter pelo menos 1 ouvinte para transferir o controle.",
        );
      }

      logger.info(
        `[Host] ${activeListeners.length} ouvintes disponíveis para transferência`,
      );

      // Build poll options with listener names
      const listenerOptions = [];
      const listenerMap = {}; // index -> userId

      for (let i = 0; i < activeListeners.length; i++) {
        const listener = activeListeners[i];
        const user = listener.user;
        const displayName =
          user.display_name ||
          user.push_name ||
          user.sender_number?.split("@")[0] ||
          "Usuário";

        listenerOptions.push(`👤 ${displayName}`);
        listenerMap[i] = user.id;
      }

      // Add cancel option
      listenerOptions.push("❌ Cancelar");

      // Create poll for host to select new host
      const pollRes = await polls.createPoll(
        client,
        chatId,
        "Quem será o novo host da jam?",
        listenerOptions,
        async (voteData) => {
          try {
            const voter = voteData.voter;

            logger.info(
              `[Host] Voto recebido - Voter: ${voter}, Host esperado: ${whatsappId}`,
            );

            // Only current host can vote
            if (voter !== whatsappId) {
              logger.debug(
                `[Host] Voto ignorado: ${voter} não é o host atual (esperado: ${whatsappId})`,
              );
              return;
            }

            const selectedIndexRaw =
              voteData.selectedIndexes && voteData.selectedIndexes[0];
            const selectedIndex =
              selectedIndexRaw != null ? Number(selectedIndexRaw) : null;

            logger.info(
              `[Host] Índice selecionado: ${selectedIndex}, voteData completo:`,
              JSON.stringify(voteData),
            );

            if (selectedIndex == null) {
              logger.warn(`[Host] Nenhum índice selecionado no voto`);
              return;
            }

            // Check if canceled
            if (selectedIndex === listenerOptions.length - 1) {
              await client.sendMessage(chatId, "❌ Transferência cancelada.");
              return;
            }

            const newHostUserId = listenerMap[selectedIndex];
            if (!newHostUserId) {
              logger.error(
                "[Host] userId não encontrado para índice selecionado",
              );
              return;
            }

            logger.info(
              `[Host] Transferindo jam ${jam.id} para usuário ${newHostUserId}`,
            );

            // Call backend to transfer host
            const transferRes = await backendClient.sendToBackend(
              `/api/jam/${jam.id}/transfer-host`,
              {
                currentHostUserId: currentUserId,
                newHostUserId,
              },
              "POST",
            );

            if (!transferRes || !transferRes.success) {
              const errorMsg =
                transferRes?.message ||
                transferRes?.error ||
                "Erro desconhecido";
              logger.error("[Host] Erro ao transferir:", errorMsg);
              await client.sendMessage(
                chatId,
                `❌ Erro ao transferir controle: ${errorMsg}`,
              );
              return;
            }

            const newHost = transferRes.jam?.host;
            const newHostName =
              newHost?.display_name ||
              newHost?.push_name ||
              activeListeners.find((l) => l.user?.id === newHostUserId)?.user
                ?.display_name ||
              "Novo host";

            // Get current host name
            const currentHostName =
              jam.host?.display_name || jam.host?.push_name || "você";

            // Announce transfer
            await client.sendMessage(
              chatId,
              `🎧 *Controle da jam transferido!*\n\n` +
                `${currentHostName} passou o controle para *${newHostName}*\n\n` +
                `Agora ${newHostName} controla a música e pode gerenciar a jam.`,
            );

            logger.info(`[Host] Transferência concluída com sucesso`);
          } catch (err) {
            logger.error("[Host] Erro no callback de votação:", err);
            await client.sendMessage(
              chatId,
              "❌ Erro ao processar transferência.",
            );
          }
        },
      );

      if (!pollRes) {
        logger.error("[Host] Falha ao criar poll");
        return reply("❌ Erro ao criar votação para transferência.");
      }

      logger.info(`[Host] Poll criado com sucesso`);
    } catch (err) {
      logger.error("[Host] Erro ao processar comando:", err);
      return reply(
        "❌ Erro ao processar transferência: " +
          (err.message || "Erro desconhecido"),
      );
    }
  },
};
