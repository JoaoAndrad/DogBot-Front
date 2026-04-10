const logger = require("../../utils/logger");
const processor = require("../../components/poll/processor");
const backendClient = require("../../services/backendClient");

/**
 * Handler for individual track voting (approve/reject single track)
 * Metadata expected: { jamId, queueEntryId, userId, trackData, eligibleVoters, whatsappId, requesterName }
 */
async function handleTrackVote(poll, votes, stats, client) {
  try {
    // Get the latest vote (most recent)
    if (!votes || votes.length === 0) {
      logger.warn("[PollHandlers] No votes found for track poll");
      return;
    }

    const latestVote = votes[votes.length - 1];
    const voter = latestVote.voter_id;
    const selectedIndexes = latestVote.selected_indexes || [];

    if (!poll || !poll.metadata) {
      logger.error("[PollHandlers] Missing poll metadata for track vote");
      return;
    }

    const metadata =
      typeof poll.metadata === "string"
        ? JSON.parse(poll.metadata)
        : poll.metadata;

    const {
      jamId,
      queueEntryId,
      userId,
      trackData,
      eligibleVoters,
      whatsappId,
      requesterName,
    } = metadata;

    // Only count votes from jam participants
    const eligibleVotersList = Array.isArray(eligibleVoters)
      ? eligibleVoters
      : [];

    if (!eligibleVotersList.includes(voter)) {
      logger.debug(`[PollHandlers] Voter ${voter} not eligible`);
      return;
    }

    const isFor = selectedIndexes && selectedIndexes.includes(0);

    // Get chat to send messages (get early for error handling)
    const chatId = poll.chat_id;
    const chat = await client.getChatById(chatId);

    // Get voter user ID (lookup com identificador completo @c.us / @lid)
    let voterUserId;
    try {
      const lookup = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
        null,
        "GET",
      );
      if (!lookup.found || !lookup.userId) {
        logger.error("[PollHandlers] Voter not found via lookup");
        await chat.sendMessage(
          `⚠️ Usuário não cadastrado. Use /cadastro primeiro.`,
        );
        return;
      }
      voterUserId = lookup.userId;
    } catch (e) {
      logger.error("[PollHandlers] Failed to get voter user:", e);
      await chat.sendMessage(
        `⚠️ Erro ao identificar votante. Certifique-se de estar cadastrado.`,
      );
      return;
    }

    // Cast vote
    let voteResultData;
    try {
      voteResultData = await backendClient.sendToBackend(
        `/api/jam/queue/${queueEntryId}/vote`,
        { userId: voterUserId, isFor },
        "POST",
      );
    } catch (e) {
      logger.error("[PollHandlers] Failed to cast vote:", e);
      await chat.sendMessage(`⚠️ Erro ao processar voto. Tente novamente.`);
      return;
    }

    if (!voteResultData.success) {
      logger.error(
        "[PollHandlers] Vote result not successful:",
        voteResultData,
      );
      await chat.sendMessage(`⚠️ Erro ao processar voto. Tente novamente.`);
      return;
    }

    const result = voteResultData;

    // Check if approved/rejected
    if (result.status === "approved") {
      await chat.sendMessage(
        `✅ *Música aprovada e adicionada à fila!*\n\n` +
          `🎵 ${trackData.trackName}\n` +
          `🎤 ${trackData.trackArtists}\n\n` +
          `Solicitada por ${requesterName}`,
      );
    } else if (result.status === "rejected") {
      await chat.sendMessage(
        `❌ *Música rejeitada*\n\n` +
          `🎵 ${trackData.trackName}\n` +
          `🎤 ${trackData.trackArtists}\n\n` +
          `Não foi adicionada à fila.`,
      );
    } else {
      // Still pending
      const statsData = result.stats;
      const statusText =
        `📊 Votação: ${statsData.votesFor} ✅ / ${statsData.votesAgainst} ❌ ` +
        `(necessário: ${statsData.needed}/${statsData.totalEligible})`;

      // Send status update (throttled to avoid spam)
      if (statsData.votesFor + statsData.votesAgainst <= 2) {
        await chat.sendMessage(statusText);
      }
    }
  } catch (err) {
    logger.error("[PollHandlers] Error processing track vote:", err);
    try {
      const chatId = poll?.chat_id;
      if (chatId && client) {
        const chat = await client.getChatById(chatId);
        await chat.sendMessage(
          `⚠️ Erro inesperado ao processar votação. Tente novamente.`,
        );
      }
    } catch (notifyError) {
      logger.error(
        "[PollHandlers] Failed to send error notification:",
        notifyError,
      );
    }
  }
}

/**
 * Handler for collection voting (approve/reject entire album/playlist)
 * Metadata expected: { jamId, userId, allTracks, collectionType, searchContext, eligibleVoters, whatsappId, requesterName, votes }
 */
async function handleCollectionVote(poll, votes, stats, client) {
  try {
    // Get the latest vote (most recent)
    if (!votes || votes.length === 0) {
      logger.warn("[PollHandlers] No votes found for collection poll");
      return;
    }

    const latestVote = votes[votes.length - 1];
    const voter = latestVote.voter_id;
    const selectedIndexes = latestVote.selected_indexes || [];

    if (!poll || !poll.metadata) {
      logger.error("[PollHandlers] Missing poll metadata for collection vote");
      return;
    }

    const metadata =
      typeof poll.metadata === "string"
        ? JSON.parse(poll.metadata)
        : poll.metadata;

    const {
      jamId,
      userId,
      allTracks,
      collectionType,
      searchContext,
      eligibleVoters,
      whatsappId,
      requesterName,
      votes: storedVotes,
    } = metadata;

    // Get chat
    const chatId = poll.chat_id;
    const chat = await client.getChatById(chatId);

    const eligibleVotersList = Array.isArray(eligibleVoters)
      ? eligibleVoters
      : [];

    // Only count votes from jam participants
    if (!eligibleVotersList.includes(voter)) {
      logger.debug(`[PollHandlers] Voter ${voter} not eligible for collection`);
      return;
    }

    const isFor = selectedIndexes && selectedIndexes.includes(0);

    // Get voter user ID
    let voterUserId;
    try {
      const lookup = await backendClient.sendToBackend(
        `/api/users/lookup?identifier=${encodeURIComponent(voter)}`,
        null,
        "GET",
      );
      if (!lookup.found || !lookup.userId) {
        logger.error("[PollHandlers] Voter user data not found for collection");
        await chat.sendMessage(
          `⚠️ Usuário não cadastrado. Use /cadastro primeiro.`,
        );
        return;
      }
      voterUserId = lookup.userId;
    } catch (e) {
      logger.error(
        "[PollHandlers] Failed to get voter user for collection:",
        e,
      );
      await chat.sendMessage(
        `⚠️ Erro ao identificar votante. Certifique-se de estar cadastrado.`,
      );
      return;
    }

    // Initialize or load votes from metadata
    let votesFor = storedVotes?.for || [userId]; // Requester auto-votes YES
    let votesAgainst = storedVotes?.against || [];

    // Remove previous vote from this voter
    votesFor = votesFor.filter((v) => v !== voterUserId);
    votesAgainst = votesAgainst.filter((v) => v !== voterUserId);

    // Add new vote
    if (isFor) {
      votesFor.push(voterUserId);
    } else {
      votesAgainst.push(voterUserId);
    }

    // Update metadata with new votes
    const updatedMetadata = {
      ...metadata,
      votes: { for: votesFor, against: votesAgainst },
    };

    // Save updated metadata back to poll
    try {
      const pollStorage = require("../../components/poll/storage");
      await pollStorage.savePoll(poll.id, {
        ...poll,
        metadata: updatedMetadata,
      });
    } catch (err) {
      logger.error("[PollHandlers] Failed to update poll metadata:", err);
    }

    const totalEligible = eligibleVotersList.length;
    const needed = Math.ceil(totalEligible / 2);

    logger.info(
      `[PollHandlers] Collection vote: ${votesFor.length}/${totalEligible} (needed: ${needed})`,
    );

    // Check if approved (majority)
    if (votesFor.length >= needed) {
      await chat.sendMessage(
        `✅ *${collectionType.charAt(0).toUpperCase() + collectionType.slice(1)} aprovado!*\n\n` +
          `📀 Adicionando ${allTracks.length} músicas à fila...\n` +
          `⏳ Isso pode levar alguns instantes.`,
      );

      let addedCount = 0;
      let failedCount = 0;

      // Add all tracks directly to queue (no individual voting)
      for (const track of allTracks) {
        try {
          const trackData = {
            trackUri: track.uri,
            trackId: track.id,
            trackName: track.name,
            trackArtists: track.artists.map((a) => a.name).join(", "),
            trackAlbum: track.album.name,
            trackImage: track.album.images[0]?.url || null,
          };

          let addData;
          try {
            addData = await backendClient.sendToBackend(
              `/api/jam/${jamId}/queue`,
              {
                userId,
                trackData,
                skipVoting: true,
              },
              "POST",
            );
          } catch (e) {
            logger.error(`[PollHandlers] Failed to add track: ${track.name}`, e);
            failedCount++;
            addData = null;
          }

          if (addData && addData.success) {
            addedCount++;
          } else if (addData !== null) {
            failedCount++;
          }

          // Progress update every 10 tracks
          if (addedCount % 10 === 0 && addedCount < allTracks.length) {
            await chat.sendMessage(
              `⏳ Progresso: ${addedCount}/${allTracks.length} músicas adicionadas...`,
            );
          }

          // Small delay to avoid overwhelming the system
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (err) {
          logger.error(
            `[PollHandlers] Failed to add track: ${track.name}`,
            err,
          );
          failedCount++;
        }
      }

      const summaryMsg =
        failedCount > 0
          ? `✅ ${addedCount} músicas adicionadas à fila!\n⚠️ ${failedCount} falharam.`
          : `✅ Todas as ${addedCount} músicas foram adicionadas à fila por ${requesterName}!`;

      await chat.sendMessage(summaryMsg);
    } else if (votesAgainst.length >= needed) {
      // Rejected
      await chat.sendMessage(
        `❌ *${collectionType.charAt(0).toUpperCase() + collectionType.slice(1)} rejeitado*\n\n` +
          `📀 ${searchContext}\n\n` +
          `Não foi adicionado à fila.`,
      );
    } else {
      // Still pending
      const statusText =
        `📊 Votação: ${votesFor.length} ✅ / ${votesAgainst.length} ❌ ` +
        `(necessário: ${needed}/${totalEligible})`;

      // Send status update (throttled to avoid spam)
      if (votesFor.length + votesAgainst.length <= 2) {
        await chat.sendMessage(statusText);
      }
    }
  } catch (err) {
    logger.error("[PollHandlers] Error processing collection vote:", err);
    try {
      const chatId = poll?.chat_id;
      if (chatId && client) {
        const chat = await client.getChatById(chatId);
        await chat.sendMessage(
          `⚠️ Erro inesperado ao processar votação de coleção. Tente novamente.`,
        );
      }
    } catch (notifyError) {
      logger.error(
        "[PollHandlers] Failed to send error notification:",
        notifyError,
      );
    }
  }
}

/**
 * Register all Spotify poll handlers with the processor
 */
function registerSpotifyPollHandlers() {
  processor.registerActionHandler("spotify_track", handleTrackVote);
  processor.registerActionHandler("spotify_collection", handleCollectionVote);

  logger.debug("[SpotifyPollHandlers] Handlers registered with processor");
}

module.exports = {
  registerSpotifyPollHandlers,
  handleTrackVote,
  handleCollectionVote,
};
