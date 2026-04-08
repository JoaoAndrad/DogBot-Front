/**
 * Flow /vinculo360 — [Admin] círculo → membro Life360 → utilizador do bot → confirmar.
 */

const { createFlow } = require("../flowBuilder");
const life360Client = require("../../../services/life360Client");

const MAX_CIRCLES = 11;
const MAX_MEMBERS = 10;
/** Opções da enquete: utilizadores + Próx./Ant. + Voltar (máx. ~12). */
const USERS_PER_PAGE = 8;

function truncateLabel(s, max = 120) {
  const t = String(s || "?").replace(/\n/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function formatUserPollLabel(u) {
  const dn = u.displayName || "—";
  const pn = u.pushName && u.pushName !== dn ? u.pushName : null;
  const num = String(u.sender_number || "").replace(/\s+/g, "");
  let s = dn;
  if (pn) s += ` (${pn})`;
  s += ` · ${num}`;
  return truncateLabel(`🧑 ${s}`);
}

/** Índice de página vindo da metadata da opção (processador pode omitir `data` no 2.º arg). */
function extractTargetUsersPage(data, meta, ctx) {
  const asNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const fromObj = (o) => {
    if (!o || typeof o !== "object") return undefined;
    return asNum(o.page);
  };
  let p = fromObj(data);
  if (p === undefined) p = fromObj(meta && meta.option && meta.option.data);
  if (p === undefined) p = fromObj(ctx && ctx.option && ctx.option.data);
  if (p === undefined) p = fromObj(ctx && ctx.data);
  return p;
}

function formatMemberName(m) {
  const parts = [m.firstName, m.lastName].filter(Boolean);
  return parts.length ? parts.join(" ") : "Membro";
}

const vinculo360Flow = createFlow("vinculo360", {
  root: {
    title: "Vínculo Life360 (admin)",
    dynamic: true,
    handler: async (ctx) => {
      let status;
      try {
        status = await life360Client.getStatus();
      } catch (e) {
        return {
          title:
            "❌ Não foi possível falar com o servidor Life360.\n\n" +
            (e.message || String(e)),
          skipPoll: true,
        };
      }

      if (!status.configured) {
        return {
          title:
            "⚠️ Life360 não está configurado no *servidor*.\n\n" +
            "Peça ao administrador para definir `LIFE360_USERNAME` e `LIFE360_PASSWORD`.",
          skipPoll: true,
        };
      }

      if (!status.authenticated) {
        return {
          title:
            "⚠️ Life360: login falhou no servidor.\n\n" +
            (status.last_error
              ? `Último erro: ${String(status.last_error).slice(0, 300)}`
              : "Verifique as credenciais no env do backend."),
          skipPoll: true,
        };
      }

      let circles;
      try {
        circles = await life360Client.getCircles();
      } catch (e) {
        return {
          title: "❌ Erro ao listar círculos: " + (e.message || String(e)),
          skipPoll: true,
        };
      }

      if (!Array.isArray(circles) || circles.length === 0) {
        return {
          title: "Nenhum círculo encontrado na conta Life360.",
          skipPoll: true,
        };
      }

      const truncated = circles.length > MAX_CIRCLES;
      const slice = circles.slice(0, MAX_CIRCLES);
      const title =
        (truncated
          ? `1️⃣ Círculo (primeiros ${MAX_CIRCLES}):`
          : "1️⃣ Escolha o círculo:") +
        "\n\nDepois: membro Life360 → utilizador do bot a atribuir.";

      const options = slice.map((c) => ({
        label: truncateLabel(`⭕ ${c.name || c.id || "?"}`),
        action: "exec",
        handler: "pickCircle",
        data: {
          circleId: c.id,
          name: c.name || String(c.id),
        },
      }));

      options.push({ label: "🔙 Sair", action: "exec", handler: "leaveVinculo" });

      return { title, options, skipPoll: false };
    },
  },

  "/members": {
    title: "Membros",
    dynamic: true,
    handler: async (ctx) => {
      const circleId = ctx.state.context && ctx.state.context.circleId;
      const circleName =
        (ctx.state.context && ctx.state.context.circleName) || "Círculo";

      if (!circleId) {
        return {
          title: "❌ Círculo não selecionado. Use /vinculo360 de novo.",
          skipPoll: true,
        };
      }

      let members;
      try {
        members = await life360Client.getMembers(circleId);
      } catch (e) {
        return {
          title: "❌ Erro ao carregar membros: " + (e.message || String(e)),
          skipPoll: true,
        };
      }

      if (!Array.isArray(members) || members.length === 0) {
        return {
          title: `Nenhum membro em “${truncateLabel(circleName, 40)}”.`,
          skipPoll: true,
        };
      }

      const truncated = members.length > MAX_MEMBERS;
      const slice = members.slice(0, MAX_MEMBERS);
      const title =
        `2️⃣ Membro Life360 — ${truncateLabel(circleName, 45)}` +
        (truncated ? ` (primeiros ${MAX_MEMBERS})` : "");

      const options = slice.map((m) => {
        const displayName = formatMemberName(m);
        return {
          label: truncateLabel(`👤 ${displayName}`),
          action: "exec",
          handler: "selectMemberForLink",
          data: {
            displayName,
            memberId: m.id,
          },
        };
      });

      options.push({ label: "🔙 Voltar aos círculos", action: "back" });

      return { title, options, skipPoll: false };
    },
  },

  "/users": {
    title: "Utilizadores",
    dynamic: true,
    handler: async (ctx) => {
      const adminWa =
        (ctx.state.context && ctx.state.context.adminWaIdentifier) || ctx.userId;
      const pending = ctx.state.context && ctx.state.context.pendingMember;
      if (!pending || !pending.memberId) {
        return {
          title: "❌ Sessão inválida. Use /vinculo360 de novo.",
          skipPoll: true,
        };
      }

      ctx.state.context = ctx.state.context || {};
      const cacheKey = pending.memberId;
      const sameMember =
        ctx.state.context.vinculoUsersCacheKey === cacheKey;
      let users = ctx.state.context.vinculoUsersList;
      if (!users || !sameMember) {
        const pageBeforeFetch = sameMember
          ? Number(ctx.state.context.usersPage) || 0
          : 0;
        let res;
        try {
          res = await life360Client.getVinculoUsers(
            adminWa,
            pending.displayName || "",
          );
        } catch (e) {
          const msg =
            e.status === 403
              ? "Apenas administradores podem usar este fluxo."
              : e.message || String(e);
          return {
            title: "❌ " + msg,
            skipPoll: true,
          };
        }
        users = (res && res.users) || [];
        ctx.state.context.vinculoUsersList = users;
        ctx.state.context.vinculoUsersCacheKey = cacheKey;
        // Só repõe página 0 ao mudar de membro Life360; se só faltava a lista em memória, mantém a página.
        ctx.state.context.usersPage = sameMember ? pageBeforeFetch : 0;
      }

      if (!users.length) {
        return {
          title: "Nenhum utilizador cadastrado na base de dados.",
          skipPoll: true,
        };
      }

      const maxPage = Math.max(0, Math.ceil(users.length / USERS_PER_PAGE) - 1);
      const page = Math.max(
        0,
        Math.min(ctx.state.context.usersPage || 0, maxPage),
      );
      ctx.state.context.usersPage = page;

      const totalPages = Math.max(1, Math.ceil(users.length / USERS_PER_PAGE));
      const start = page * USERS_PER_PAGE;
      const slice = users.slice(start, start + USERS_PER_PAGE);

      const title =
        `3️⃣ Utilizador a receber o vínculo — página ${page + 1}/${totalPages}\n` +
        `Total: ${users.length} · Ordem: match com *${truncateLabel(pending.displayName || "membro", 40)}* (push_name priorizado em empates)`;

      const options = slice.map((u) => ({
        label: formatUserPollLabel(u),
        action: "exec",
        handler: "pickTargetUser",
        data: {
          targetUserId: u.id,
          displayName: u.displayName,
          sender_number: u.sender_number,
        },
      }));

      if (page < totalPages - 1) {
        options.push({
          label: "➡️ Próxima página",
          action: "exec",
          handler: "goToUsersPage",
          data: { page: page + 1 },
        });
      }
      if (page > 0) {
        options.push({
          label: "⬅️ Página anterior",
          action: "exec",
          handler: "goToUsersPage",
          data: { page: page - 1 },
        });
      }

      options.push({ label: "🔙 Voltar aos membros", action: "back" });

      return { title, options, skipPoll: false };
    },
  },

  "/confirm": {
    title: "Confirmar",
    dynamic: true,
    handler: async (ctx) => {
      const pending = ctx.state.context && ctx.state.context.pendingMember;
      const target = ctx.state.context && ctx.state.context.pendingTarget;
      if (!pending || !pending.memberId || !target || !target.targetUserId) {
        return {
          title: "❌ Sessão inválida. Use /vinculo360 de novo.",
          skipPoll: true,
        };
      }
      const title =
        `4️⃣ Confirmar vínculo?\n\n` +
        `*Membro Life360:* ${pending.displayName}\n` +
        `ID: \`${pending.memberId}\`\n\n` +
        `*Utilizador do bot:* ${target.displayName}\n` +
        `${target.sender_number}`;
      return {
        title,
        options: [
          { label: "✅ Confirmar vínculo", action: "exec", handler: "confirmLink" },
          { label: "🔙 Voltar", action: "back" },
          { label: "❌ Cancelar", action: "exec", handler: "cancelVinculo" },
        ],
        skipPoll: false,
      };
    },
  },

  handlers: {
    pickCircle: async (ctx, data) => {
      ctx.state.context = ctx.state.context || {};
      ctx.state.context.circleId = data.circleId;
      ctx.state.context.circleName = data.name;
      ctx.state.history.push("/");
      ctx.state.path = "/members";
    },

    selectMemberForLink: async (ctx, data) => {
      ctx.state.context = ctx.state.context || {};
      ctx.state.context.pendingMember = {
        memberId: data.memberId,
        displayName: data.displayName,
      };
      delete ctx.state.context.vinculoUsersList;
      delete ctx.state.context.vinculoUsersCacheKey;
      ctx.state.context.usersPage = 0;
      ctx.state.history.push("/members");
      ctx.state.path = "/users";
    },

    /**
     * Página: `data.page` ou `meta.option.data.page` (processador backend pode
     * não repassar `option.data` no 2.º argumento). Sem lista em memória, não
     * fazer clamp aqui — o nó /users recalcula após o GET.
     */
    goToUsersPage: async (ctx, data, meta) => {
      ctx.state.context = ctx.state.context || {};
      const list = ctx.state.context.vinculoUsersList || [];
      const hasList = Array.isArray(list) && list.length > 0;
      const maxPage = hasList
        ? Math.max(0, Math.ceil(list.length / USERS_PER_PAGE) - 1)
        : null;

      let p = extractTargetUsersPage(data, meta, ctx);
      if (p === undefined) {
        p = (ctx.state.context.usersPage || 0) + 1;
      }

      if (maxPage !== null) {
        ctx.state.context.usersPage = Math.max(0, Math.min(p, maxPage));
      } else {
        ctx.state.context.usersPage = Math.max(0, p);
      }
      return { rerenderCurrent: true };
    },

    pickTargetUser: async (ctx, data) => {
      ctx.state.context = ctx.state.context || {};
      ctx.state.context.pendingTarget = {
        targetUserId: data.targetUserId,
        displayName: data.displayName,
        sender_number: data.sender_number,
      };
      ctx.state.history.push("/users");
      ctx.state.path = "/confirm";
    },

    confirmLink: async (ctx) => {
      const adminWa =
        (ctx.state.context && ctx.state.context.adminWaIdentifier) || ctx.userId;
      const pending = ctx.state.context && ctx.state.context.pendingMember;
      const target = ctx.state.context && ctx.state.context.pendingTarget;
      if (!adminWa || !pending || !pending.memberId || !target || !target.targetUserId) {
        await ctx.reply("❌ Dados em falta. Use /vinculo360 de novo.");
        return { end: true };
      }
      try {
        await life360Client.linkLife360ForUser(
          adminWa,
          target.targetUserId,
          pending.memberId,
        );
        await ctx.reply(
          `✅ Vínculo criado: membro Life360 *${pending.displayName}* → ` +
            `utilizador *${target.displayName}*.`,
        );
      } catch (e) {
        let msg = e.message || String(e);
        if (e.body && e.body.error) msg = String(e.body.error);
        await ctx.reply("❌ " + msg);
      }
      return { end: true };
    },

    cancelVinculo: async (ctx) => {
      await ctx.reply("Operação cancelada.");
      return { end: true };
    },

    leaveVinculo: async (ctx) => {
      await ctx.reply("👋 Fechado.");
      return { end: true };
    },
  },
});

module.exports = vinculo360Flow;
