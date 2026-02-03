
  try {
    const voter = voteData.voter; // Já vem resolvido para @c.us pelo pollComponent
    const selectedOptions = voteData.selectedOptions || [];
    const selectedIndexes = voteData.selectedIndexes || [];

    // Ignorar voto se for do criador da votação
    if (voter === creatorId) {
      logger.debug(
        `[Skip] Voto do criador ignorado: ${voter} é o criador da votação`
      );
      return;
    }

    if (voter === creatorWhatsAppId) {
      logger.debug(`[Skip] Voto do criador ignorado: ${voter} é o criador da votação`);
      return;
    }

    // 0 = Sim, 1 = Não
    const isFor = selectedIndexes.includes(0);

    logger.info(
      `[Skip] Voto recebido: voter=${voter} isFor=${isFor} voteId=${collaborativeVoteId}`
    );

    // Get voter's userId by looking up in database
    const userRes = await backendClient.sendToBackend(
      `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
      null,
      "GET"
    );

    if (!userRes || !userRes.found) {
      logger.warn(`[Skip] Voter ${voter} não encontrado no banco`);
      await client.sendMessage(
        chatId,
        `⚠️ @${
          voter.split("@")[0]
        }, envie /cadastro no meu privado para criar sua conta.`,
        { mentions: [voter] }
      );
      return;
    }

    // Check if user has Spotify connected
    if (!userRes.hasSpotify) {
      logger.warn(`[Skip] Voter ${voter} não tem conta Spotify conectada`);
      await client.sendMessage(
        chatId,
        `⚠️ @${
          voter.split("@")[0]
        }, envie /conectar para vincular sua conta no Spotify.`,
        { mentions: [voter] }
      );
      return;
    }

    // Cast vote
    const castRes = await backendClient.sendToBackend(
      `/api/groups/votes/${collaborativeVoteId}/cast`,
      {
        userId: userRes.userId,
        isFor,
      }
    );

    logger.debug(`[Skip] Cast response:`, castRes);

    if (!castRes || !castRes.vote) {
      logger.error("[Skip] Erro ao registrar voto", {
        castRes,
        userId: userRes.userId,
        isFor,
        voteId: collaborativeVoteId,
      });
      return;
    }

    const updatedVote = castRes.vote;
    const stats = castRes.stats;

    logger.info(
      `[Skip] Voto registrado. Status: ${updatedVote.status}, Stats: ${stats.votesFor}/${stats.totalEligible}`
    );

    // Get voter info for mention
    const voterContact = await client.getContactById(voter);
    const voterName =
      voterContact?.pushname || voterContact?.name || voter.split("@")[0];

    // Enviar atualização sobre o voto (se ainda não passou nem falhou)
    if (updatedVote.status === "pending") {
      const votesNeeded = stats.needed - stats.votesFor;

      await client.sendMessage(
        chatId,
        `@${voter.split("@")[0]} ${
          isFor ? "também votou para pular" : "votou para continuar"
        } ${updatedVote.trackName}, ainda ${
          votesNeeded === 1
            ? "precisa de 1 voto"
            : `precisam de ${votesNeeded} votos`
        }. Mais alguém?`,
        { mentions: [voter] }
      );
    }

    // Check if resolved
    if (updatedVote.status === "passed") {
      // Execute skip for this jam via backend
      if (!jamId) {
        logger.error("[Skip] jamId missing when trying to execute skip");
        await client.sendMessage(chatId, `⚠️ Votação aprovada, mas falha ao identificar a jam.`);
        return;
      }

      const skipRes = await backendClient.sendToBackend(`/api/jam/${jamId}/skip`, { userId: creatorUserId }, "POST");

      if (skipRes && skipRes.success) {
        await client.sendMessage(chatId, `✅ Votação aprovada! Pulando música e sincronizando ouvintes... (${stats.votesFor}/${stats.totalEligible} votos)`);
      } else {
        const errText = skipRes?.error || skipRes?.details || "Erro desconhecido";
        if (errText === "NO_ACTIVE_DEVICE" || (skipRes && skipRes.error === "NO_ACTIVE_DEVICE")) {
          await client.sendMessage(chatId, `⚠️ Votação aprovada, mas o host não possui um dispositivo Spotify ativo. Peça para ele abrir o Spotify.`);
        } else {
          await client.sendMessage(chatId, `⚠️ Votação aprovada, mas erro ao executar skip: ${errText}`);
        }
      }
    } else if (updatedVote.status === "failed") {
      await client.sendMessage(
        chatId,
        `❌ Votação rejeitada. A música continua tocando. (${stats.votesFor}/${stats.totalEligible} votos)`
      );
    }
  } catch (err) {
    logger.error("[Skip] handleSkipVote erro:", err);
  }
}
