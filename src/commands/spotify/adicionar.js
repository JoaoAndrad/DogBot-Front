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
    const match = url.match(/playlist[\/:]([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  } catch (err) {
    return null;
  }
}

/**
 * Extract Spotify album ID from URL
 */
function extractAlbumId(url) {
  try {
    const match = url.match(/album[\/:]([a-zA-Z0-9]+)/);
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
 * Get tracks from Spotify album
 */
async function getAlbumTracks(albumId) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/spotify/album/${albumId}`);

    if (!response.ok) {
      return { success: false, error: "FETCH_FAILED" };
    }

    const data = await response.json();

    if (!data.success || !data.album) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      tracks: data.album.tracks.items || [],
      albumName: data.album.name,
    };
  } catch (err) {
    logger.error("[AdicionarCommand] Error fetching album:", err);
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
    url.searchParams.set("limit", "20");

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
  usage: "/adicionar <nome da música, link da playlist ou álbum>",

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
          "❌ Por favor, especifique o nome da música, link da playlist ou álbum.\n\nExemplos:\n*/adicionar bohemian rhapsody*\n*/adicionar https://open.spotify.com/playlist/...*\n*/adicionar https://open.spotify.com/album/...*",
        );
      }

      // Check if query is a Spotify URL (playlist or album)
      const playlistId = extractPlaylistId(query);
      const albumId = extractAlbumId(query);

      let tracks = [];
      let searchContext = "";

      if (playlistId) {
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

        tracks = playlistResult.tracks;
        searchContext = `da playlist "${playlistResult.playlistName}"`;
      } else if (albumId) {
        await reply(`🔍 Buscando músicas do álbum...`);

        const albumResult = await getAlbumTracks(albumId);

        if (
          !albumResult.success ||
          !albumResult.tracks ||
          albumResult.tracks.length === 0
        ) {
          return reply(
            "❌ Não foi possível carregar o álbum. Verifique o link.",
          );
        }

        tracks = albumResult.tracks;
        searchContext = `do álbum "${albumResult.albumName}"`;
      } else {
        await reply(`🔍 Buscando "${query}" no Spotify...`);

        const searchResult = await searchSpotifyTrack(query);

        if (
          !searchResult.success ||
          !searchResult.tracks ||
          searchResult.tracks.length === 0
        ) {
          return reply("❌ Nenhuma música encontrada. Tente outro termo.");
        }

        tracks = searchResult.tracks;
        searchContext = `para "${query}"`;
      }

      // Get chat for sending polls
      const chat = await msg.getChat();

      // Helper function to add track with voting
      const addTrackWithVoting = async (selectedTrack) => {
        try {
          // Add to queue
          const trackData = {
            trackUri: selectedTrack.uri,
            trackId: selectedTrack.id,
            trackName: selectedTrack.name,
            trackArtists: selectedTrack.artists.map((a) => a.name).join(", "),
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
            await chat.sendMessage(`❌ ${addData.message || addData.error}`);
            return;
          }

          const queueEntry = addData.queueEntry;

          // Get all jam participants for voting
          const eligibleVoters = [
            jam.host.sender_number,
            ...jam.listeners.map((l) => l.user.sender_number),
          ].map((num) => `${num}@c.us`);

          // Automatically cast YES vote from requester
          try {
            await fetch(`${BACKEND_URL}/api/jam/queue/${queueEntry.id}/vote`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, isFor: true }),
            });
            logger.info(
              `[AdicionarCommand] Auto-voted YES for requester: ${userId}`,
            );
          } catch (err) {
            logger.error("[AdicionarCommand] Error auto-voting:", err);
          }

          // Create mentions for all participants except the requester
          const mentions = eligibleVoters.filter(
            (voter) => voter !== whatsappId,
          );

          // Create voting poll
          const requesterName = await resolveUserName(senderNumber, client);

          // Build message with mentions
          let messageText =
            `🎵 *${requesterName}* quer adicionar:\n\n` +
            `🎵 *${selectedTrack.name}*\n` +
            `🎤 ${selectedTrack.artists.map((a) => a.name).join(", ")}\n\n` +
            `Vote para aprovar ou rejeitar: `;

          // Add mention tags for participants
          for (const mentionId of mentions) {
            messageText += `@${mentionId.replace("@c.us", "")} `;
          }

          await chat.sendMessage(messageText, {
            mentions: mentions,
          });

          const votePoll = await polls.createPoll(
            client,
            chatId,
            "Aprovar esta música?",
            ["✅ Sim", "❌ Não"],
            {
              allowMultiple: false,
              voteType: "spotify_track",
              metadata: {
                actionType: "spotify_track",
                jamId: jam.id,
                queueEntryId: queueEntry.id,
                userId,
                trackData: {
                  trackName: selectedTrack.name,
                  trackArtists: selectedTrack.artists
                    .map((a) => a.name)
                    .join(", "),
                },
                eligibleVoters,
                whatsappId,
                requesterName,
              },
            },
          );
        } catch (err) {
          logger.error("[AdicionarCommand] Error adding track:", err);
          await chat.sendMessage(
            "❌ Erro ao adicionar música. Tente novamente em alguns instantes.",
          );
        }
      };

      // Helper function to create track selection poll with pagination
      const createTrackSelectionPoll = async (
        allTracks,
        page = 0,
        isPlaylistOrAlbum = false,
      ) => {
        const TRACKS_PER_PAGE = 5;
        const startIndex = page * TRACKS_PER_PAGE;
        const endIndex = startIndex + TRACKS_PER_PAGE;
        const pageTracks = allTracks.slice(startIndex, endIndex);
        const hasNextPage = endIndex < allTracks.length;

        const pollOptions = [];

        // Option 1: Add all tracks (only for playlist/album)
        if (isPlaylistOrAlbum) {
          const collectionType = playlistId ? "playlist" : "álbum";
          pollOptions.push(
            `➕ Adicionar ${collectionType} completo (${allTracks.length} músicas)`,
          );
        }

        // Options 2-6: Individual tracks
        pageTracks.forEach((track, index) => {
          const artists = track.artists.map((a) => a.name).join(", ");
          const trackNumber = startIndex + index + 1;
          pollOptions.push(`${trackNumber}. ${track.name} - ${artists}`);
        });

        // Next page option
        if (hasNextPage) {
          pollOptions.push("➡️ Próxima página");
        }

        // Cancel option
        pollOptions.push("❌ Cancelar");

        const pollTitle = isPlaylistOrAlbum
          ? `Músicas ${searchContext} (${startIndex + 1}-${Math.min(endIndex, allTracks.length)}/${allTracks.length})`
          : `Qual música adicionar?`;

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
                  return;
                }

                const selectedIndex = vote.selectedIndexes[0];
                const optionOffset = isPlaylistOrAlbum ? 1 : 0;

                // Check if canceled
                if (selectedIndex === pollOptions.length - 1) {
                  await chat.sendMessage("❌ Adição cancelada.");
                  return;
                }

                // Check if "Next page" was selected
                if (hasNextPage && selectedIndex === pollOptions.length - 2) {
                  await chat.sendMessage("📄 Carregando próxima página...");
                  await createTrackSelectionPoll(
                    allTracks,
                    page + 1,
                    isPlaylistOrAlbum,
                  );
                  return;
                }

                // Check if "Add all" was selected
                if (isPlaylistOrAlbum && selectedIndex === 0) {
                  const collectionType = playlistId ? "playlist" : "álbum";
                  const requesterName = await resolveUserName(
                    senderNumber,
                    client,
                  );

                  // Get all jam participants for voting
                  const eligibleVoters = [
                    jam.host.sender_number,
                    ...jam.listeners.map((l) => l.user.sender_number),
                  ].map((num) => `${num}@c.us`);

                  // Create mentions for all participants except the requester
                  const mentions = eligibleVoters.filter(
                    (voter) => voter !== whatsappId,
                  );

                  // Build message with mentions
                  let messageText =
                    `🎵 *${requesterName}* quer adicionar:\n\n` +
                    `📀 ${searchContext} completo (${allTracks.length} músicas)\n\n` +
                    `${requesterName} já votou ✅\n\n` +
                    `Vote para aprovar ou rejeitar: `;

                  // Add mention tags for participants
                  for (const mentionId of mentions) {
                    messageText += `@${mentionId.replace("@c.us", "")} `;
                  }

                  await chat.sendMessage(messageText, {
                    mentions: mentions,
                  });

                  // Create approval poll for entire collection
                  const collectionVotePoll = await polls.createPoll(
                    client,
                    chatId,
                    `Aprovar ${collectionType} completo?`,
                    ["✅ Sim", "❌ Não"],
                    {
                      allowMultiple: false,
                      voteType: "spotify_collection",
                      metadata: {
                        actionType: "spotify_collection",
                        jamId: jam.id,
                        userId,
                        allTracks,
                        collectionType,
                        searchContext,
                        eligibleVoters,
                        whatsappId,
                        requesterName,
                        votes: {
                          for: [userId], // Requester auto-votes YES
                          against: [],
                        },
                      },
                    },
                  );

                  return;
                }

                // Individual track selected
                const trackIndex = isPlaylistOrAlbum
                  ? startIndex + (selectedIndex - optionOffset)
                  : selectedIndex;

                const selectedTrack = allTracks[trackIndex];

                if (!selectedTrack) {
                  await chat.sendMessage("❌ Opção inválida.");
                  return;
                }

                await addTrackWithVoting(selectedTrack);
              } catch (err) {
                logger.error("[AdicionarCommand] Error in poll vote:", err);
                await chat.sendMessage("❌ Erro ao processar seleção.");
              }
            },
          },
        );
      };

      // Determine if this is a playlist/album search
      const isPlaylistOrAlbum = !!(playlistId || albumId);

      // Create initial poll with pagination
      await createTrackSelectionPoll(tracks, 0, isPlaylistOrAlbum);
    } catch (err) {
      logger.error("[AdicionarCommand] Error:", err);
      return reply(
        "❌ Erro ao processar comando. Tente novamente em alguns instantes.",
      );
    }
  },
};
