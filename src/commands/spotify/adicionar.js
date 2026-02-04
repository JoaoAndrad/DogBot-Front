const axios = require("axios");
const logger = require("../../../../backend/src/lib/logger");
const { getConfig } = require("../../../core/config");
const getPushName = require("../../../utils/getPushName");
const { JamMonitor } = require("../../../services/jamMonitor");
const { createPoll } = require("../../../components/poll");

const config = getConfig();

/**
 * Search Spotify tracks
 */
async function searchSpotifyTrack(query) {
  try {
    const response = await axios.get(
      `${config.BACKEND_URL}/api/spotify/search`,
      {
        params: {
          query,
          type: "track",
          limit: 5,
        },
      },
    );

    if (!response.data.success) {
      return { success: false, error: response.data.error };
    }

    return {
      success: true,
      tracks: response.data.tracks,
    };
  } catch (err) {
    logger.error("[AdicionarCommand] Error searching Spotify:", err);
    return { success: false, error: err.message };
  }
}

/**
 * /adicionar <música> - Add track to collaborative queue with voting
 */
async function adicionarCommand(msg, args) {
  const sender = msg.from;
  const senderNumber = sender.replace("@c.us", "");
  const chat = await msg.getChat();

  try {
    // Check if jam is active
    const jamState = JamMonitor.getJamState(senderNumber);

    if (!jamState) {
      await msg.reply("❌ Você não está em uma jam ativa.");
      return;
    }

    // Check if jam is collaborative
    if (jamState.jamType !== "collaborative") {
      await msg.reply(
        "❌ Esta jam não está no modo colaborativo. Use */democratizar* para ativar.",
      );
      return;
    }

    // Get search query
    const query = args.join(" ");

    if (!query || query.trim().length === 0) {
      await msg.reply(
        "❌ Por favor, especifique o nome da música.\n\nExemplo: */adicionar bohemian rhapsody*",
      );
      return;
    }

    // Search Spotify
    await msg.reply(`🔍 Buscando "${query}" no Spotify...`);

    const searchResult = await searchSpotifyTrack(query);

    if (
      !searchResult.success ||
      !searchResult.tracks ||
      searchResult.tracks.length === 0
    ) {
      await msg.reply("❌ Nenhuma música encontrada. Tente outro termo.");
      return;
    }

    const tracks = searchResult.tracks.slice(0, 5);

    // Create poll for track selection
    const pollOptions = tracks.map((track, index) => {
      const artists = track.artists.map((a) => a.name).join(", ");
      return `${index + 1}. ${track.name} - ${artists}`;
    });

    pollOptions.push("❌ Cancelar");

    const pollTitle = `Qual música adicionar?`;

    const poll = await createPoll(chat, pollTitle, pollOptions, {
      allowMultiple: false,
      onVote: async (vote) => {
        try {
          // Check if voter is the requester
          if (vote.voter !== sender) {
            return; // Only track selection by requester
          }

          const selectedIndex = vote.selectedOptions[0];

          // Check if canceled
          if (selectedIndex === pollOptions.length - 1) {
            await msg.reply("❌ Adição cancelada.");
            return;
          }

          const selectedTrack = tracks[selectedIndex];

          if (!selectedTrack) {
            await msg.reply("❌ Opção inválida.");
            return;
          }

          // Get user ID from backend
          const userResponse = await axios.get(
            `${config.BACKEND_URL}/api/users/by-sender-number/${senderNumber}`,
          );

          if (!userResponse.data.success) {
            await msg.reply("❌ Erro ao buscar usuário.");
            return;
          }

          const userId = userResponse.data.user.id;

          // Add to queue
          const trackData = {
            trackUri: selectedTrack.uri,
            trackId: selectedTrack.id,
            trackName: selectedTrack.name,
            trackArtists: selectedTrack.artists.map((a) => a.name).join(", "),
            trackAlbum: selectedTrack.album.name,
            trackImage: selectedTrack.album.images[0]?.url || null,
          };

          const addResponse = await axios.post(
            `${config.BACKEND_URL}/api/jam/${jamState.jamId}/queue`,
            {
              userId,
              trackData,
            },
          );

          if (!addResponse.data.success) {
            await msg.reply(
              `❌ ${addResponse.data.message || addResponse.data.error}`,
            );
            return;
          }

          const queueEntry = addResponse.data.queueEntry;

          // Create voting poll
          await chat.sendMessage(
            `🎵 *${await getPushName(senderNumber)}* quer adicionar:\n\n` +
              `🎵 *${selectedTrack.name}*\n` +
              `🎤 ${selectedTrack.artists.map((a) => a.name).join(", ")}\n\n` +
              `Vote para aprovar ou rejeitar:`,
          );

          // Get all jam participants for voting
          const jamResponse = await axios.get(
            `${config.BACKEND_URL}/api/jam/${jamState.jamId}`,
          );

          if (!jamResponse.data.success) {
            await msg.reply("❌ Erro ao buscar jam para votação.");
            return;
          }

          const jam = jamResponse.data.jam;
          const eligibleVoters = [
            jam.host.sender_number,
            ...jam.listeners.map((l) => l.user.sender_number),
          ].map((num) => `${num}@c.us`);

          const votePoll = await createPoll(
            chat,
            "Aprovar esta música?",
            ["✅ Sim", "❌ Não"],
            {
              allowMultiple: false,
              onVote: async (voteData) => {
                try {
                  // Only count votes from jam participants
                  if (!eligibleVoters.includes(voteData.voter)) {
                    return;
                  }

                  const isFor = voteData.selectedOptions[0] === 0;
                  const voterNumber = voteData.voter.replace("@c.us", "");

                  // Get voter user ID
                  const voterResponse = await axios.get(
                    `${config.BACKEND_URL}/api/users/by-sender-number/${voterNumber}`,
                  );

                  if (!voterResponse.data.success) {
                    return;
                  }

                  const voterUserId = voterResponse.data.user.id;

                  // Cast vote
                  const voteResponse = await axios.post(
                    `${config.BACKEND_URL}/api/jam/queue/${queueEntry.id}/vote`,
                    {
                      userId: voterUserId,
                      isFor,
                    },
                  );

                  if (!voteResponse.data.success) {
                    return;
                  }

                  const result = voteResponse.data;

                  // Check if approved/rejected
                  if (result.status === "approved") {
                    await chat.sendMessage(
                      `✅ *Música aprovada!*\n\n` +
                        `🎵 ${selectedTrack.name}\n` +
                        `🎤 ${selectedTrack.artists.map((a) => a.name).join(", ")}\n\n` +
                        `Adicionada à fila por ${await getPushName(senderNumber)}`,
                    );
                  } else if (result.status === "rejected") {
                    await chat.sendMessage(
                      `❌ *Música rejeitada*\n\n` +
                        `🎵 ${selectedTrack.name}\n` +
                        `🎤 ${selectedTrack.artists.map((a) => a.name).join(", ")}\n\n` +
                        `Não foi adicionada à fila.`,
                    );
                  } else {
                    // Still pending
                    const stats = result.stats;
                    const statusText =
                      `📊 Votação: ${stats.votesFor} ✅ / ${stats.votesAgainst} ❌ ` +
                      `(necessário: ${stats.needed}/${stats.totalEligible})`;

                    // Send status update (throttled to avoid spam)
                    if (stats.votesFor + stats.votesAgainst <= 2) {
                      await chat.sendMessage(statusText);
                    }
                  }
                } catch (err) {
                  logger.error(
                    "[AdicionarCommand] Error processing vote:",
                    err,
                  );
                }
              },
            },
          );
        } catch (err) {
          logger.error("[AdicionarCommand] Error adding track:", err);
          await msg.reply(
            "❌ Erro ao adicionar música. Tente novamente em alguns instantes.",
          );
        }
      },
    });
  } catch (err) {
    logger.error("[AdicionarCommand] Error:", err);
    await msg.reply(
      "❌ Erro ao processar comando. Tente novamente em alguns instantes.",
    );
  }
}

module.exports = {
  name: "adicionar",
  aliases: ["add", "adiciona"],
  description: "Adiciona música à fila colaborativa com votação",
  category: "spotify",
  requiredArgs: 1,
  usage: "/adicionar <nome da música>",
  execute: adicionarCommand,
};
