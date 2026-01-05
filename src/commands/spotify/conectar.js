const backend = require("../../../src/services/backendClient");

module.exports = {
  // primary command name (users send `/conectar`) and an alias
  name: "conectar",
  aliases: ["spotify.conectar"],
  description: "Inicia fluxo de conexão do Spotify (abre link de autorização)",
  async execute(ctx) {
    // ctx may have message, reply, sender info
    const reply =
      typeof ctx.reply === "function" ? ctx.reply : (t) => console.log(t);

    // try to identify a user id to attach to the auth session
    const userId =
      (ctx.message && (ctx.message.from || ctx.message.author)) ||
      ctx.sender ||
      null;

    try {
      const payload = {
        userId,
        scopes:
          "user-read-private user-read-email user-read-playback-state user-read-currently-playing",
        show_dialog: true,
      };

      const res = await backend.sendToBackend("/spotify/start", payload);
      if (!res || !res.auth_url) {
        await reply(
          "Erro ao iniciar conexão com o Spotify. Tente novamente mais tarde."
        );
        return;
      }

      const text = `Para conectar sua conta Spotify, abra o link abaixo e autorize:\n${res.auth_url}\n\nApós autorizar, volte aqui.`;
      await reply(text);

      // Start polling to check if user completed auth
      const pollAuth = async () => {
        let attempts = 0;
        const maxAttempts = 30; // 5 minutes (10s interval)

        const interval = setInterval(async () => {
          attempts++;

          try {
            // Check if user has spotify connected now
            const lookupResult = await backend.sendToBackend(
              `/api/users/lookup`,
              { identifier: userId },
              "POST"
            );

            if (lookupResult && lookupResult.found && lookupResult.hasSpotify) {
              clearInterval(interval);
              await reply(
                "✅ *Conta Spotify conectada com sucesso!*\\n\\n" +
                  "Agora você pode usar todos os recursos do Spotify. Envie */spotify* para começar!"
              );
            }
          } catch (err) {
            console.log("[conectar] Polling error:", err.message);
          }

          // Stop after max attempts
          if (attempts >= maxAttempts) {
            clearInterval(interval);
            console.log("[conectar] Polling timeout for userId:", userId);
          }
        }, 10000); // Check every 10 seconds
      };

      // Start polling in background (don't await)
      pollAuth().catch((err) => {
        console.log("[conectar] Polling failed:", err.message);
      });
    } catch (err) {
      console.log("spotify.conectar error", err && err.message);
      await reply("Falha ao iniciar conexão com o Spotify.");
    }
  },
};
