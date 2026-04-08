/**
 * Labels PT para repeatKind e texto de resumo de rotina (rascunho ou API).
 */

function repeatKindLabel(draft) {
  if (!draft || !draft.repeatKind) return "—";
  const k = draft.repeatKind;
  if (k === "daily") return "Todos os dias";
  if (k === "everyNDays") {
    const n = draft.repeatEveryN || 2;
    return `A cada ${n} dias`;
  }
  if (k === "weekdays") return "Dias úteis";
  if (k === "weekly") return "Semanal";
  if (k === "biweekly") return "Semana sim, semana não";
  if (k === "monthly") return "Mensal";
  return String(k);
}

function formatTimeMinutes(m) {
  const n = Number(m);
  if (Number.isNaN(n)) return "—";
  const h = Math.floor(n / 60);
  const min = n % 60;
  return `${h}:${String(min).padStart(2, "0")}`;
}

function formatYmdToBr(ymd) {
  if (!ymd) return "—";
  const s = String(ymd).slice(0, 10);
  const [y, mo, d] = s.split("-");
  if (!y || !mo || !d) return s;
  return `${d}/${mo}/${y}`;
}

function userLabel(u) {
  if (!u) return "?";
  return (
    u.display_name ||
    u.push_name ||
    u.sender_number ||
    (u.id ? String(u.id).slice(0, 8) + "…" : "?")
  );
}

/**
 * @param {object} routine - resposta API createRoutine / findById (assignees com user)
 */
function formatRoutineSummaryFromApi(routine) {
  if (!routine) return "✅ Rotina criada.";
  const title = routine.title || "—";
  const rep = repeatKindLabel(routine);
  const sd = routine.startDate;
  const startStr =
    !sd
      ? ""
      : typeof sd === "string"
        ? sd.slice(0, 10)
        : sd instanceof Date
          ? sd.toISOString().slice(0, 10)
          : String(sd).slice(0, 10);
  const start = formatYmdToBr(startStr);
  const time = formatTimeMinutes(routine.anchorTimeMinutes);
  const tz = routine.timezone || "America/Sao_Paulo";

  const assignees = Array.isArray(routine.assignees) ? routine.assignees : [];
  const creatorId = routine.createdByUserId;
  const creatorRow = assignees.find((a) => a.userId === creatorId || a.user?.id === creatorId);
  const creatorName = creatorRow
    ? userLabel(creatorRow.user)
    : null;
  const otherNames = assignees
    .filter((a) => a.userId !== creatorId && a.user?.id !== creatorId)
    .map((a) => userLabel(a.user))
    .filter(Boolean);

  let people = "";
  if (creatorName) {
    people = `👤 *Criador:* *${creatorName}*`;
    if (otherNames.length) {
      people += `\n👥 *Também na rotina:* ${otherNames.map((n) => `*${n}*`).join(", ")}`;
    } else {
      people += `\n👥 *Outros participantes:* nenhum (só o criador).`;
    }
  } else if (assignees.length) {
    people = `👥 *Participantes:* ${assignees.map((a) => userLabel(a.user)).map((n) => `*${n}*`).join(", ")}`;
  } else {
    people = "👥 *Participantes:* —";
  }

  return (
    `✅ *Rotina criada*\n\n` +
    `📝 *Nome:* *${title}*\n` +
    `🔁 *Repetição:* ${rep}\n` +
    `📅 *Início:* ${start}\n` +
    `⏰ *Horário:* ${time}\n` +
    `🌐 *Fuso:* ${tz}\n` +
    `${people}`
  );
}

module.exports = {
  repeatKindLabel,
  formatTimeMinutes,
  formatYmdToBr,
  formatRoutineSummaryFromApi,
};
