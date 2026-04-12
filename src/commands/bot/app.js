const backendClient = require("../../services/backendClient");

module.exports = {
  name: "app",
  description:
    "Gera código de 6 dígitos para emparelhar a app DogBot (só no privado; apenas VIP)",
  async execute(ctx) {
    const msg = ctx.message;
    const reply = ctx.reply;

    if (!msg) {
      if (typeof reply === "function") {
        await reply("❌ Não foi possível processar o pedido.");
      }
      return;
    }

    const info = ctx.info || {};
    let isGroup = !!(msg && msg.isGroup) || !!info.is_group;
    if (!isGroup && msg.from && String(msg.from).endsWith("@g.us")) {
      isGroup = true;
    }

    if (isGroup) {
      return reply(
        "⚠️ O emparelhamento da app só funciona no privado. Envie /app na conversa direta com o bot.",
      );
    }

    let waId = msg.from;
    try {
      const contact = await msg.getContact();
      if (contact && contact.id && contact.id._serialized) {
        waId = contact.id._serialized;
      }
    } catch (err) {
      console.log("[Command:app] getContact:", err && err.message);
    }

    try {
      const out = await backendClient.sendToBackend(
        "/api/internal/companion/pairing-code",
        { waId },
      );
      const code = out && out.code != null ? String(out.code) : "";
      const expiresAt = out && out.expiresAt ? new Date(out.expiresAt) : null;
      let expiresLine = "";
      if (expiresAt && !Number.isNaN(expiresAt.getTime())) {
        try {
          expiresLine = `\n\nVálido até: ${expiresAt.toLocaleString("pt-PT")}`;
        } catch (e) {
          expiresLine = `\n\nVálido até: ${expiresAt.toISOString()}`;
        }
      }
      await reply(
        `📱 *Código para a app DogBot:* ${code}\n\n` +
          `Abre a app, confirma o URL do servidor se precisares, e introduz estes 6 dígitos.${expiresLine}`,
      );
    } catch (err) {
      const status = err && err.status;
      const body = err && err.body;
      const codeErr =
        body && typeof body.error === "string" ? body.error : null;
      if (status === 404 || codeErr === "user_not_found") {
        return reply(
          "❌ Cadastro não encontrado. Envie /cadastro aqui no privado e volta a usar /app depois de registado.",
        );
      }
      if (status === 403 || codeErr === "not_vip") {
        return reply(
          "❌ O código da app DogBot está disponível apenas para utilizadores VIP. Contate o administrador do bot.",
        );
      }
      console.error("[Command:app]", err && err.message, status, body);
      await reply(
        "❌ Não foi possível gerar o código agora. Tenta de novo mais tarde.",
      );
    }
  },
};
