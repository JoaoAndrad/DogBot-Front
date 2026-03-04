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

    // Check if it's a group chat
    const chatId = ctx.message?.from || null;
    const isGroup = chatId && chatId.includes("@g.us");

    if (isGroup) {
      await reply("❌ O comando */conectar* só funciona no privado.");
      return;
    }

    // Usar getContact() para obter o número real (@c.us) em vez de @lid
    let userId = null;
    try {
      const msg = ctx.message;
      if (msg && typeof msg.getContact === "function") {
        const contact = await msg.getContact();
        userId = contact.id._serialized || contact.id;
      } else {
        userId = (msg && (msg.from || msg.author)) || ctx.sender || null;
      }
    } catch (err) {
      console.log("[conectar] Failed to resolve contact:", err.message);
      userId =
        (ctx.message && (ctx.message.from || ctx.message.author)) ||
        ctx.sender ||
        null;
    }

    try {
      const payload = {
        userId,
        scopes:
          "user-read-private user-read-email user-read-playback-state user-read-currently-playing user-modify-playback-state",
        show_dialog: true,
      };

      const res = await backend.sendToBackend("/spotify/start", payload);
      if (!res || !res.auth_url) {
        await reply(
          "Erro ao iniciar conexão com o Spotify. Tente novamente mais tarde.",
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
              "POST",
            );

            if (lookupResult && lookupResult.found && lookupResult.hasSpotify) {
              clearInterval(interval);
              const acct = lookupResult.spotifyAccount || null;
              const appIndex =
                acct && typeof acct.appIndex === "number" ? acct.appIndex : 0;
              const serverNumber = appIndex + 1;
              await reply(
                `✅ Você foi conectado com sucesso no servidor ${serverNumber}.\\n\\n` +
                  `Por favor, me informe o seu e-mail utilizado no Spotify para que eu possa adicioná-lo à nossa lista branca (requisito do Spotify).`,
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
