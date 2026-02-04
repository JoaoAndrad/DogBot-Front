const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const polls = require("../../components/poll");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * Resolve user name from WhatsApp contact
 */
async function resolveUserName(senderNumber, client) {
  if (!senderNumber || !client) return "Anônimo";

  try {
    const whatsappId = senderNumber.includes("@")
      ? senderNumber
      : `${senderNumber}@c.us`;

    const contact = await client.getContactById(whatsappId);
    return contact?.pushname || contact?.name || senderNumber;
  } catch (err) {
    return senderNumber;
  }
}

/**
 * Extract Spotify playlist ID from URL
 */
function extractPlaylistId(url) {
  try {
    // Match patterns like:
    // https://open.spotify.com/playlist/3xthKP3TSHuDHN1tg50OFf
    // https://open.spotify.com/playlist/3xthKP3TSHuDHN1tg50OFf?si=...
    const match = url.match(/playlist[\/:]([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  } catch (err) {
    return null;
  }
}

/**
 * Get tracks from Spotify playlist
 */
async function getPlaylistTracks(playlistId) {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/spotify/playlist/${playlistId}/tracks`,
    );

    if (!response.ok) {
      return { success: false, error: "FETCH_FAILED" };
    }

    const data = await response.json();

    if (!data.success) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      tracks: data.tracks,
      playlistName: data.playlistName,
    };
  } catch (err) {
    logger.error("[AdicionarCommand] Error fetching playlist:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Search Spotify tracks
 */
async function searchSpotifyTrack(query) {
  try {
    const url = new URL(`${BACKEND_URL}/api/spotify/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("type", "track");
    url.searchParams.set("limit", "5");

    const response = await fetch(url.toString());

    if (!response.ok) {
      return { success: false, error: "FETCH_FAILED" };
    }

    const data = await response.json();

    if (!data.success) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      tracks: data.tracks,
    };
  } catch (err) {
    logger.error("[AdicionarCommand] Error searching Spotify:", err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  name: "adicionar",
  aliases: ["add", "adiciona"],
  description: "Adiciona música à fila colaborativa com votação",
  category: "spotify",
  requiredArgs: 1,
  usage: "/adicionar <nome da música ou link da playlist>",

  async execute(ctx) {
    const { message, reply, client, args = [] } = ctx;
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
        logger.error("[AdicionarCommand] Could not resolve contact:", err);
      }

      if (!whatsappId) {
        return reply("⚠️ Não foi possível identificar o usuário.");
      }

      const senderNumber = whatsappId.replace("@c.us", "");

      // Get active jam for this group
      const jamsRes = await backendClient.sendToBackend(
        `/api/jam/active?chatId=${chatId}`,
        null,
        "GET",
      );

      if (!jamsRes.success || !jamsRes.jams || jamsRes.jams.length === 0) {
        return reply("❌ Não há jam ativa neste grupo.");
      }

      const jam = jamsRes.jams[0];

      // Get user ID from backend
      const userResponse = await fetch(
        `${BACKEND_URL}/api/users/by-sender-number/${senderNumber}`,
      );

      if (!userResponse.ok) {
        return reply("❌ Erro ao verificar usuário.");
      }

      const userData = await userResponse.json();
      if (!userData.success) {
        return reply("❌ Erro ao verificar usuário.");
      }

      const userId = userData.user.id;

      // Check if user is the host
      const isHost = jam.hostUserId === userId;

      // If user is NOT the host, check if jam is collaborative
      if (!isHost && jam.jamType !== "collaborative") {
        return reply(
          "❌ Esta jam não está no modo colaborativo. Peça ao host para usar */democratizar* primeiro.",
        );
      }

      // Get search query
      const query = args.join(" ");

      if (!query || query.trim().length === 0) {
        return reply(
          "❌ Por favor, especifique o nome da música ou link da playlist.\n\nExemplos:\n*/adicionar bohemian rhapsody*\n*/adicionar https://open.spotify.com/playlist/...*",
        );
      }

      // Check if query is a Spotify playlist URL
      const playlistId = extractPlaylistId(query);

      let tracks = [];
      let searchContext = "";

      if (playlistId) {
        // Fetch playlist tracks
        await reply(`🔍 Buscando músicas da playlist...`);

        const playlistResult = await getPlaylistTracks(playlistId);

        if (
          !playlistResult.success ||
          !playlistResult.tracks ||
          playlistResult.tracks.length === 0
        ) {
          return reply(
            "❌ Não foi possível carregar a playlist. Verifique o link.",
          );
        }

        tracks = playlistResult.tracks.slice(0, 5);
        searchContext = `da playlist "${playlistResult.playlistName}"`;
      } else {
        // Search Spotify
        await reply(`🔍 Buscando "${query}" no Spotify...`);

        const searchResult = await searchSpotifyTrack(query);

        if (
          !searchResult.success ||
          !searchResult.tracks ||
          searchResult.tracks.length === 0
        ) {
          return reply("❌ Nenhuma música encontrada. Tente outro termo.");
        }

        tracks = searchResult.tracks.slice(0, 5);
        searchContext = `para "${query}"`;
      }

      // Get chat for sending polls
      const chat = await msg.getChat();

      // Create poll for track selection
      const pollOptions = tracks.map((track, index) => {
        const artists = track.artists.map((a) => a.name).join(", ");
        return `${index + 1}. ${track.name} - ${artists}`;
      });

      pollOptions.push("❌ Cancelar");

      const pollTitle = `Qual música adicionar?`;

      const poll = await polls.createPoll(
        client,
        chatId,
        pollTitle,
        pollOptions,
        {
          allowMultiple: false,
          onVote: async (vote) => {
            try {
              // Check if voter is the requester
              if (vote.voter !== whatsappId) {
                return; // Only track selection by requester
              }

              const selectedIndex = vote.selectedIndexes[0];

              // Check if canceled
              if (selectedIndex === pollOptions.length - 1) {
                await chat.sendMessage("❌ Adição cancelada.");
                return;
              }

              const selectedTrack = tracks[selectedIndex];

              if (!selectedTrack) {
                await chat.sendMessage("❌ Opção inválida.");
                return;
              }

              // Add to queue (userId already obtained earlier in execution)
              const trackData = {
                trackUri: selectedTrack.uri,
                trackId: selectedTrack.id,
                trackName: selectedTrack.name,
                trackArtists: selectedTrack.artists
                  .map((a) => a.name)
                  .join(", "),
                trackAlbum: selectedTrack.album.name,
                trackImage: selectedTrack.album.images[0]?.url || null,
              };

              const addResponse = await fetch(
                `${BACKEND_URL}/api/jam/${jam.id}/queue`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId, trackData }),
                },
              );

              if (!addResponse.ok) {
                await chat.sendMessage("❌ Erro ao adicionar música.");
                return;
              }

              const addData = await addResponse.json();
              if (!addData.success) {
                await chat.sendMessage(
                  `❌ ${addData.message || addData.error}`,
                );
                return;
              }

              const queueEntry = addData.queueEntry;

              // Create voting poll
              const requesterName = await resolveUserName(senderNumber, client);
              await chat.sendMessage(
                `🎵 *${requesterName}* quer adicionar:\n\n` +
                  `🎵 *${selectedTrack.name}*\n` +
                  `🎤 ${selectedTrack.artists.map((a) => a.name).join(", ")}\n\n` +
                  `Vote para aprovar ou rejeitar:`,
              );

              // Get all jam participants for voting
              const eligibleVoters = [
                jam.host.sender_number,
                ...jam.listeners.map((l) => l.user.sender_number),
              ].map((num) => `${num}@c.us`);

              const votePoll = await polls.createPoll(
                client,
                chatId,
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

                      const isFor = voteData.selectedIndexes[0] === 0;
                      const voterNumber = voteData.voter.replace("@c.us", "");

                      // Get voter user ID
                      const voterResponse = await fetch(
                        `${BACKEND_URL}/api/users/by-sender-number/${voterNumber}`,
                      );

                      if (!voterResponse.ok) {
                        return;
                      }

                      const voterData = await voterResponse.json();
                      if (!voterData.success) {
                        return;
                      }

                      const voterUserId = voterData.user.id;

                      // Cast vote
                      const voteResponse = await fetch(
                        `${BACKEND_URL}/api/jam/queue/${queueEntry.id}/vote`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ userId: voterUserId, isFor }),
                        },
                      );

                      if (!voteResponse.ok) {
                        return;
                      }

                      const voteResultData = await voteResponse.json();
                      if (!voteResultData.success) {
                        return;
                      }

                      const result = voteResultData;

                      // Check if approved/rejected
                      if (result.status === "approved") {
                        await chat.sendMessage(
                          `✅ *Música aprovada!*\n\n` +
                            `🎵 ${selectedTrack.name}\n` +
                            `🎤 ${selectedTrack.artists.map((a) => a.name).join(", ")}\n\n` +
                            `Adicionada à fila por ${requesterName}`,
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
              await chat.sendMessage(
                "❌ Erro ao adicionar música. Tente novamente em alguns instantes.",
              );
            }
          },
        },
      );
    } catch (err) {
      logger.error("[AdicionarCommand] Error:", err);
      return reply(
        "❌ Erro ao processar comando. Tente novamente em alguns instantes.",
      );
    }
  },
};
