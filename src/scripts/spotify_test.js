const spotifyClient = require("../services/spotifyClient");

async function test() {
  console.log("Iniciando teste spotify client...");

  // 1) start auth
  const start = await spotifyClient.startAuth();
  console.log("startAuth ->", start);

  // If auth_url present, print instruction
  if (start && start.auth_url) {
    console.log("\nAbra no navegador para autenticar:");
    console.log(start.auth_url);
  }

  // 2) try fetching current tracks
  try {
    const current = await spotifyClient.getCurrentTracks();
    console.log("current-tracks ->", current);
  } catch (e) {
    console.log("Erro getCurrentTracks", e.message || e);
  }

  // 3) sample search (if desired)
  try {
    const s = await spotifyClient.searchTracks("Never gonna give you up");
    console.log("searchTracks ->", s);
  } catch (e) {
    console.log("Erro searchTracks", e.message || e);
  }
}

test();
