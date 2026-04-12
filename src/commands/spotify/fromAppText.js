"use strict";

/**
 * Comandos simulados pelo DogBubble (gateway: msg.fromApp).
 */
function isFromApp(msg) {
  return Boolean(msg && msg.fromApp);
}

/** Linha inicial para respostas multi-linha no grupo. */
function prefix(fromApp) {
  return fromApp ? "🫧 *DogBubble*\n\n" : "";
}

/** Rodapé opcional em confirmações curtas. */
function suffix(fromApp) {
  return fromApp ? "\n\n🫧 _Pedido feito pelo DogBubble._" : "";
}

module.exports = { isFromApp, prefix, suffix };
