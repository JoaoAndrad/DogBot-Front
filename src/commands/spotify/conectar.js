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
    } catch (err) {
      console.log("spotify.conectar error", err && err.message);
      await reply("Falha ao iniciar conexão com o Spotify.");
    }
  },
};
