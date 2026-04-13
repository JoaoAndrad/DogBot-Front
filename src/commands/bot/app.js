const backendClient = require("../../services/backendClient");
const logger = require("../../utils/logger");
const { jidFromContact } = require("../../utils/whatsapp/getUserData");

module.exports = {
  name: "app",
  aliases: ["bubble", "dogbubble", "aplicativo"],
  description:
    "Gera código de 6 dígitos para emparelhar a app DogBubble (só no privado; restrições VIP via painel)",
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
      const j = jidFromContact(contact);
      if (j) waId = j;
    } catch (err) {
      logger.debug("[Command:app] getContact:", err && err.message);
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
          expiresLine = `${expiresAt.toLocaleString("pt-BR")}`;
        } catch (e) {
          expiresLine = `${expiresAt.toISOString()}`;
        }
      }
      await reply(
        `📱 *Código para sincronização com o *DogBubble*:* ${code}\n\n` +
          `Digite esse código no app para sincronizar com sua conta, o código irá expirar em ${expiresLine}.`,
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
      logger.error("[Command:app]", err && err.message, status, body);
      await reply(
        "❌ Não foi possível gerar o código agora. Tente de novo mais tarde.",
      );
    }
  },
};
