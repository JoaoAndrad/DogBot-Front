/**
 * Barra de progresso estilo “ponteiro”: comprimento fixo, marcador ● na posição
 * do percentual (0% início, 100% fim). Largura curta para caber em chats móveis.
 */
const PLAYBACK_PROGRESS_BAR_SEGMENTS = 14;

function renderPlaybackProgressBar(percent) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const w = PLAYBACK_PROGRESS_BAR_SEGMENTS;
  const idx = Math.round((p / 100) * (w - 1));
  let out = "";
  for (let i = 0; i < w; i++) {
    out += i === idx ? "●" : "━";
  }
  return out;
}

module.exports = {
  PLAYBACK_PROGRESS_BAR_SEGMENTS,
  renderPlaybackProgressBar,
};
