const logger = require("../../utils/logger");
const processor = require("../../components/poll/processor");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

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
    const voterNumber = voter.replace("@c.us", "");

    // Get voter user ID
    const voterResponse = await fetch(
      `${BACKEND_URL}/api/users/by-sender-number/${voterNumber}`,
    );

    if (!voterResponse.ok) {
      logger.error("[PollHandlers] Failed to get voter user");
      return;
    }

    const voterData = await voterResponse.json();
    if (!voterData.success) {
      logger.error("[PollHandlers] Voter data not found");
      return;
    }

    const voterUserId = voterData.user.id;

    // Cast vote
    const voteResponse = await fetch(
      `${BACKEND_URL}/api/jam/queue/${queueEntryId}/vote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: voterUserId, isFor }),
      },
    );

    if (!voteResponse.ok) {
      logger.error("[PollHandlers] Failed to cast vote");
      return;
    }

    const voteResultData = await voteResponse.json();
    if (!voteResultData.success) {
      logger.error("[PollHandlers] Vote result not successful");
      return;
    }

    const result = voteResultData;

    // Get chat to send messages
    const chatId = poll.chat_id;
    const chat = await client.getChatById(chatId);

    // Check if approved/rejected
    if (result.status === "approved") {
      await chat.sendMessage(
        `✅ *Música aprovada!*\n\n` +
          `🎵 ${trackData.trackName}\n` +
          `🎤 ${trackData.trackArtists}\n\n` +
          `Adicionada à fila por ${requesterName}`,
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
    const voterNumber = voter.replace("@c.us", "");

    // Get voter user ID
    const voterResponse = await fetch(
      `${BACKEND_URL}/api/users/by-sender-number/${voterNumber}`,
    );

    if (!voterResponse.ok) {
      logger.error("[PollHandlers] Failed to get voter user");
      return;
    }

    const voterUserData = await voterResponse.json();
    if (!voterUserData.success) {
      logger.error("[PollHandlers] Voter data not found");
      return;
    }

    const voterUserId = voterUserData.user.id;

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

          const addResponse = await fetch(
            `${BACKEND_URL}/api/jam/${jamId}/queue`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId,
                trackData,
                skipVoting: true,
              }),
            },
          );

          if (addResponse.ok) {
            const addData = await addResponse.json();
            if (addData.success) {
              addedCount++;
            } else {
              failedCount++;
            }
          } else {
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
  }
}

/**
 * Register all Spotify poll handlers with the processor
 */
function registerSpotifyPollHandlers() {
  processor.registerActionHandler("spotify_track", handleTrackVote);
  processor.registerActionHandler("spotify_collection", handleCollectionVote);

  logger.info("[SpotifyPollHandlers] Handlers registered with processor");
}

module.exports = {
  registerSpotifyPollHandlers,
  handleTrackVote,
  handleCollectionVote,
};
