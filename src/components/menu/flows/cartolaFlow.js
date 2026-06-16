"use strict";

const fetch = require("node-fetch");
const { createFlow } = require("../flowBuilder");
const cartolaClient = require("../../../services/cartolaClient");
const conversationState = require("../../../services/conversationState");
const logger = require("../../../utils/logger");

async function _sendShieldSticker(client, chatId, svgUrl) {
  try {
    const res = await fetch(svgUrl, { timeout: 8000 });
    if (!res.ok) return false;
    const buf = await res.buffer();
    const sharp = require("sharp");
    const pngBuf = await sharp(buf).png().toBuffer();
    const stickerHelper = require("../../../utils/media/stickerHelper");
    return await stickerHelper.sendBufferAsSticker(client, chatId, pngBuf, {
      fullOnly: true,
    });
  } catch (e) {
    logger.debug("[cartola-shield] sticker error:", e.message);
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POSICAO = { 1: "GOL", 2: "LAT", 3: "ZAG", 4: "MEI", 5: "ATA", 6: "TEC" };

function formatPontuacao(pontos) {
  if (pontos == null) return "–";
  return Number(pontos).toFixed(2).replace(".", ",");
}

function formatMercadoStatus(rodada) {
  if (!rodada) return "❓ Mercado indisponível";
  const status = rodada.mercadoAberto
    ? "🟢 Mercado *aberto*"
    : "🔴 Mercado *fechado*";
  const rodadaNum = rodada.rodada ? `Rodada *${rodada.rodada}*` : "";
  return [rodadaNum, status].filter(Boolean).join(" — ");
}

// ─── Flow principal ───────────────────────────────────────────────────────────

const cartolaFlow = createFlow("cartola", {
  root: {
    title: "⚽ *Cartola FC*",
    dynamic: true,
    handler: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      const options = isGroup
        ? [
            { label: "🏠 Meu time", action: "exec", handler: "showMyTeam" },
            {
              label: "🔍 Scouts do meu time",
              action: "exec",
              handler: "showScout",
            },
            {
              label: "📊 Parcial do grupo",
              action: "exec",
              handler: "showGroupParcial",
            },
            {
              label: "⭐ Destaques do grupo",
              action: "exec",
              handler: "showDestaques",
            },
            {
              label: "🏆 Ranking da liga",
              action: "exec",
              handler: "showLeagueRanking",
            },
            { label: "📊 Rodada atual", action: "exec", handler: "showRodada" },
            { label: "❓ Dúvidas", action: "goto", target: "/duvidas" },
            { label: "⚙️ Configurações", action: "goto", target: "/config" },
            { label: "👋 Sair", action: "exec", handler: "leave" },
          ]
        : [
            { label: "🏠 Meu time", action: "exec", handler: "showMyTeam" },
            {
              label: "🔍 Scouts do meu time",
              action: "exec",
              handler: "showScout",
            },
            { label: "📊 Rodada atual", action: "exec", handler: "showRodada" },
            { label: "❓ Dúvidas", action: "goto", target: "/duvidas" },
            { label: "⚙️ Configurações", action: "goto", target: "/config" },
            { label: "👋 Sair", action: "exec", handler: "leave" },
          ];
      return { title: "⚽ *Cartola FC*", options };
    },
  },

  "/config": {
    title: "⚙️ *Configurações — Cartola FC*",
    dynamic: true,
    handler: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      const options = [
        {
          label: "🔗 Vincular meu time",
          action: "exec",
          handler: "startTeamLink",
        },
        ...(isGroup
          ? [
              {
                label: "🏆 Vincular liga (grupo)",
                action: "exec",
                handler: "startLeagueLink",
              },
              {
                label: "🔔 Notificações do grupo",
                action: "goto",
                target: "/config/notificacoes",
              },
            ]
          : []),
        { label: "🔙 Voltar", action: "back" },
      ];
      return { title: "⚙️ *Configurações — Cartola FC*", options };
    },
  },

  "/config/notificacoes": {
    title: "🔔 *Notificações do grupo*",
    dynamic: true,
    handler: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      if (!isGroup) {
        await ctx.reply(
          "🔔 Configurações de notificações são exclusivas para grupos.",
        );
        return { redirect: "/config" };
      }

      let s = {};
      try {
        const res = await cartolaClient.getGroupSettings(ctx.chatId);
        s = res?.settings || res || {};
      } catch (e) {
        logger.warn("[cartolaFlow] getGroupSettings:", e.message);
      }

      const on = (v, def = true) =>
        (v === undefined ? def : v) !== false ? "✅" : "⬜";
      const parcialLabel = s.notify_parcial_interval
        ? `✅ Parcial automática — a cada ${s.notify_parcial_interval} min`
        : "⬜ Parcial automática — desligada";

      const statusLine = s.active ? "🟢 *Ativo*" : "🔴 *Inativo*";
      const toggleLabel = s.active
        ? "🔴 Desligar notificações"
        : "🟢 Ligar notificações";

      const options = [
        { label: toggleLabel, action: "exec", handler: "toggleNotAtivo" },
        {
          label: `${on(s.notify_gol)} Gol`,
          action: "exec",
          handler: "toggleNotGol",
        },
        {
          label: `${on(s.notify_assist)} Assistência`,
          action: "exec",
          handler: "toggleNotAssist",
        },
        {
          label: `${on(s.notify_cartao_vermelho)} Cartão vermelho`,
          action: "exec",
          handler: "toggleNotCV",
        },
        {
          label: `${on(s.notify_cartao_amarelo, false)} Cartão amarelo`,
          action: "exec",
          handler: "toggleNotCA",
        },
        {
          label: parcialLabel,
          action: "goto",
          target: "/config/notificacoes/parcial",
        },
        {
          label: `${on(s.notify_virada)} Virada de liderança`,
          action: "exec",
          handler: "toggleNotVirada",
        },
        {
          label: `${on(s.notify_resultado)} Resultado final`,
          action: "exec",
          handler: "toggleNotResultado",
        },
        { label: "🔙 Voltar", action: "back" },
      ];

      return { title: `🔔 *Notificações do grupo — ${statusLine}*`, options };
    },
  },

  "/config/notificacoes/parcial": {
    title: "📊 *Parcial automática*",
    options: [
      {
        label: "🔕 Desligar parcial automática",
        action: "exec",
        handler: "setParcial0",
      },
      { label: "⏱ A cada 30 min", action: "exec", handler: "setParcial30" },
      {
        label: "⏱ A cada 60 min (1h)",
        action: "exec",
        handler: "setParcial60",
      },
      { label: "⏱ A cada 90 min", action: "exec", handler: "setParcial90" },
      { label: "🔙 Voltar", action: "back" },
    ],
  },

  "/duvidas": {
    title: "❓ *Dúvidas — Cartola FC*",
    options: [
      {
        label: "🔗 Como vincular meu time",
        action: "exec",
        handler: "faqVincular",
      },
      { label: "🔍 Scouts e pontuação", action: "exec", handler: "faqScouts" },
      { label: "🏆 Liga do grupo", action: "exec", handler: "faqLiga" },
      {
        label: "📋 Comandos disponíveis",
        action: "exec",
        handler: "faqComandos",
      },
      {
        label: "🔔 Notificações do grupo",
        action: "exec",
        handler: "faqNotificacoes",
      },
      { label: "🔙 Voltar", action: "back" },
    ],
  },

  handlers: {
    // ── FAQ ──────────────────────────────────────────────────────────────────
    faqVincular: async (ctx) => {
      await ctx.reply(
        [
          "🔗 *Como vincular meu time*",
          "",
          "1. Abra o Cartola FC no celular ou navegador",
          "2. Acesse seu time e veja a URL:",
          "   _cartola.globo.com/#!/time/*19513040*_",
          "3. Copie o número (ou o slug) e envie no privado",
          "",
          "Para vincular, use */cartola* → ⚙️ Configurações → 🔗 Vincular meu time",
          "",
          "_A vinculação é feita apenas no privado — em grupos o bot ignora a entrada._",
        ].join("\n"),
      );
      return { noRender: true };
    },

    faqScouts: async (ctx) => {
      await ctx.reply(
        [
          "🔍 *Scouts e pontuação*",
          "",
          "Os scouts são os eventos individuais de cada atleta durante a rodada.",
          "",
          "⚽ Gol • 🎯 Assistência • 🔒 Sem gol sofrido • 🛡️ Desarme",
          "🧤 Defesa difícil • 🟨 Cartão amarelo • 🟥 Vermelho • ❌ Pênalti perdido",
          "",
          "O *capitão* tem seus pontos dobrados — indicado com ⭐.",
          "",
          "Para ver os scouts:",
          "• */cartola → 🔍 Scouts do meu time* — seus atletas",
          "• */scout @usuario* — scouts do time de alguém do grupo",
        ].join("\n"),
      );
      return { noRender: true };
    },

    faqLiga: async (ctx) => {
      await ctx.reply(
        [
          "🏆 *Liga do grupo*",
          "",
          "O bot suporta ligas públicas e privadas (competições do tipo Pontos Corridos).",
          "",
          "Para vincular:",
          "Use */cartola* → ⚙️ Configurações → 🏆 Vincular liga (grupo)",
          "",
          "Copie o slug ou URL da liga no Cartola FC:",
          "_cartola.globo.com/#!/competicoes/pontoscorridos/*slug*_",
          "",
          "Após vinculada, use *🏆 Ranking da liga* para ver a classificação.",
          "",
          "_A vinculação de liga só pode ser feita dentro do grupo._",
        ].join("\n"),
      );
      return { noRender: true };
    },

    faqComandos: async (ctx) => {
      await ctx.reply(
        [
          "📋 *Comandos disponíveis*",
          "",
          "*/cartola* — Abre este menu",
          "*/scout* — Scouts do seu próprio time",
          "*/scout @usuario* — Scouts do time de alguém do grupo",
        ].join("\n"),
      );
      return { noRender: true };
    },

    faqNotificacoes: async (ctx) => {
      await ctx.reply(
        [
          "🔔 *Notificações do grupo*",
          "",
          "O bot pode avisar o grupo automaticamente durante a rodada:",
          "",
          "⚽ *Gol* de um atleta escalado por alguém do grupo",
          "🎯 *Assistência*",
          "🟥 *Cartão vermelho*",
          "🟨 *Cartão amarelo* _(opcional, desligado por padrão)_",
          "📊 *Parcial automática* — a cada 30, 60 ou 90 min",
          "🏆 *Virada de liderança* no ranking do grupo",
          "✅ *Resultado final* da rodada",
          "",
          "Configure em */cartola* → ⚙️ Configurações → 🔔 Notificações do grupo.",
        ].join("\n"),
      );
      return { noRender: true };
    },

    // ── Meu time ─────────────────────────────────────────────────────────────
    showMyTeam: async (ctx) => {
      let saved;
      try {
        const { team } = await cartolaClient.getUserTeam(ctx.userId);
        saved = team;
      } catch (e) {
        logger.error("[cartolaFlow] getUserTeam:", e.message);
        await ctx.reply("❌ Erro ao buscar seu time. Tente novamente.");
        return { noRender: true };
      }

      if (!saved) {
        await ctx.reply(
          "⚽ *Meu time*\n\n" +
            "Você ainda não vinculou seu time.\n\n" +
            "No privado, use ⚙️ *Configurações → Vincular meu time* para começar.\n\n" +
            "_Você vai precisar do ID numérico do seu time — encontra na URL do Cartola:\n" +
            "cartola.globo.com/#!/time/*123456*_",
        );
        return { noRender: true };
      }

      try {
        const { data } = await cartolaClient.getMyTeamData(ctx.userId);
        const time = data?.time || {};
        const atletas = data?.atletas || [];
        const capitaoId = data?.capitao_id;
        const pontosTotais = data?.pontos;

        const lines = [
          `🏠 *${time.nome || saved.team_name || saved.slug}*`,
          `👤 ${time.nome_cartola || "–"}`,
          "",
        ];

        if (atletas.length) {
          const titulares = atletas.slice(0, 11);
          const reservas = atletas.slice(11);

          lines.push("*Escalação:*");
          for (const a of titulares) {
            const isCap = a.atleta_id === capitaoId;
            const pos = POSICAO[a.posicao_id] || "?";
            const rawPts = a.pontos_num;
            const pts =
              rawPts != null
                ? ` — ${formatPontuacao(isCap ? rawPts * 2 : rawPts)} pts`
                : "";
            const capMark = isCap ? " ⭐" : "";
            lines.push(`• [${pos}] ${a.apelido || a.nome}${capMark}${pts}`);
          }

          if (reservas.length) {
            lines.push("", "*Banco:*");
            for (const a of reservas) {
              const pos = POSICAO[a.posicao_id] || "?";
              const pts =
                a.pontos_num != null
                  ? ` — ${formatPontuacao(a.pontos_num)} pts`
                  : "";
              lines.push(`• [${pos}] ${a.apelido || a.nome}${pts}`);
            }
          }
        } else {
          lines.push("_Escalação não disponível_");
        }

        if (pontosTotais != null) {
          lines.push("", `📊 *Total: ${formatPontuacao(pontosTotais)} pts*`);
        }

        await ctx.reply(lines.join("\n"));
        if (time.url_escudo_svg && ctx.client) {
          await _sendShieldSticker(ctx.client, ctx.chatId, time.url_escudo_svg);
        }
      } catch (e) {
        if (e.message === "team_not_found" || e.message === "no_team_saved") {
          await ctx.reply(
            `⚽ *${saved.team_name || saved.slug}*\n\nTime não encontrado. Use ⚙️ Configurações para re-vincular.`,
          );
        } else {
          logger.error("[cartolaFlow] getMyTeamData:", e.message);
          await ctx.reply(
            `⚽ *${saved.team_name || saved.slug}*\n\n_Dados indisponíveis no momento._`,
          );
        }
      }

      return { noRender: true };
    },

    // ── Scouts do meu time ───────────────────────────────────────────────────
    showScout: async (ctx) => {
      let saved;
      try {
        const { team } = await cartolaClient.getUserTeam(ctx.userId);
        saved = team;
      } catch (e) {
        await ctx.reply("❌ Erro ao buscar seu time. Tente novamente.");
        return { noRender: true };
      }

      if (!saved) {
        await ctx.reply(
          "🔍 *Scouts do meu time*\n\n" +
            "Você ainda não vinculou seu time.\n\n" +
            "No privado, use ⚙️ *Configurações → Vincular meu time*.",
        );
        return { noRender: true };
      }

      const SCOUT_LABEL = {
        G: "⚽ Gol",
        A: "🎯 Assist",
        FT: "🥅 Trave",
        FD: "🥅 Fin.Defendida",
        FF: "💨 Fora",
        DS: "🛡️ Desarme",
        FS: "⚠️ F.Sofrida",
        SG: "🔒 S/Gol",
        DE: "🧤 Defesa",
        DD: "🧤 Def.Difícil",
        FC: "🦵 Falta",
        V: "✅ Vitória",
        CA: "🟨 Amarelo",
        CV: "🟥 Vermelho",
        I: "🚑 Impedimento",
        PP: "❌ Pên.Perdido",
        PC: "⚡ Pên.Comet.",
        GC: "🚫 G.Contra",
      };

      try {
        const { data } = await cartolaClient.getMyTeamData(ctx.userId);
        const atletas = data?.atletas || [];
        const capitaoId = data?.capitao_id;
        const time = data?.time || {};

        const comMovimento = atletas.filter(
          (a) =>
            Object.values(a.scout || {}).some((v) => v > 0) ||
            (a.pontos_num ?? 0) !== 0,
        );

        const lines = [
          `🔍 *Scouts — ${time.nome || saved.team_name || saved.slug}*`,
          "",
        ];

        if (!comMovimento.length) {
          lines.push("_Nenhum atleta pontuou ainda nesta rodada._");
        } else {
          for (const a of comMovimento) {
            const isCap = a.atleta_id === capitaoId;
            const capMark = isCap ? " ⭐" : "";
            const pts = formatPontuacao(
              isCap ? (a.pontos_num ?? 0) * 2 : (a.pontos_num ?? 0),
            );
            const pos = POSICAO[a.posicao_id] || "?";
            lines.push("");
            lines.push(
              `*[${pos}] ${a.apelido || a.nome}${capMark}* — ${pts} pts`,
            );
            const entries = Object.entries(a.scout || {}).filter(
              ([, v]) => v > 0,
            );
            if (entries.length) {
              const str = entries
                .map(
                  ([k, v]) => `${SCOUT_LABEL[k] || k}${v > 1 ? ` ×${v}` : ""}`,
                )
                .join(", ");
              lines.push(`  └ ${str}`);
            }
          }
        }

        if (data?.pontos != null) {
          lines.push("", `📊 *Total: ${formatPontuacao(data.pontos)} pts*`);
        }

        await ctx.reply(lines.join("\n"));
        if (time.url_escudo_svg && ctx.client) {
          await _sendShieldSticker(ctx.client, ctx.chatId, time.url_escudo_svg);
        }
      } catch (e) {
        logger.error("[cartolaFlow] showScout:", e.message);
        await ctx.reply("❌ Dados de scouts indisponíveis no momento.");
      }

      return { noRender: true };
    },

    // ── Destaques do grupo ────────────────────────────────────────────────────
    showDestaques: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      if (!isGroup) {
        await ctx.reply("⭐ Os destaques só estão disponíveis em grupos.");
        return { noRender: true };
      }

      const SCOUT_ICON = {
        G: "⚽",
        A: "🎯",
        FT: "🥅",
        FD: "🥅",
        DD: "🧤",
        DS: "🛡️",
        SG: "🔒",
        CA: "🟨",
        CV: "🟥",
        PP: "❌",
        GC: "🚫",
      };
      const medals = ["🥇", "🥈", "🥉"];

      try {
        const { ranking } = await cartolaClient.getGroupParcial(ctx.chatId);

        if (!ranking || !ranking.length) {
          await ctx.reply(
            "⭐ *Destaques do grupo*\n\n" +
              "Nenhum membro vinculou seu time ainda.\n\n" +
              "Use ⚙️ *Configurações → Vincular meu time*.",
          );
          return { noRender: true };
        }

        // Flatten todos os atletas com dono e pontos exibidos (capitão 2x)
        const allAtletas = ranking.flatMap((r) =>
          (r.atletas || []).map((a) => ({
            ...a,
            owner: r.displayName,
            teamName: r.teamName,
            pts_exibido: a.is_capitao
              ? (a.pontos_num ?? 0) * 2
              : (a.pontos_num ?? 0),
          })),
        );

        const topAtletas = allAtletas
          .filter((a) => (a.pontos_num ?? 0) > 0)
          .sort((a, b) => b.pts_exibido - a.pts_exibido)
          .slice(0, 3);

        const lines = [
          "⭐ *Destaques do grupo*",
          "",
          "🏅 *Melhores atletas*",
          "",
        ];

        if (topAtletas.length) {
          for (let i = 0; i < topAtletas.length; i++) {
            const a = topAtletas[i];
            const capMark = a.is_capitao ? " ⭐" : "";
            const scoutStr = Object.entries(a.scout || {})
              .filter(([k, v]) => v > 0 && SCOUT_ICON[k])
              .map(([k, v]) => `${SCOUT_ICON[k]} x${v}`)
              .join(" ");
            lines.push(
              `${medals[i] || `${i + 1}.`} *${a.apelido}${capMark}* — ${formatPontuacao(a.pts_exibido)} pts`,
            );
            lines.push(`   Usuário: ${a.owner}`);
            if (a.teamName) lines.push(`   Time: ${a.teamName}`);
            if (a.posicao) lines.push(`   Posição: ${a.posicao}`);
            lines.push(`   Lances: ${scoutStr || "Sem eventos"}`);
            if (i < topAtletas.length - 1) lines.push("");
          }
          lines.push("");
        }

        lines.push("─────────────────", "", "📊 *Ranking do grupo*", "");
        for (let i = 0; i < ranking.length; i++) {
          const r = ranking[i];
          lines.push(
            `${medals[i] || `${i + 1}.`} ${r.displayName} — *${formatPontuacao(r.pontos)} pts*`,
          );
        }

        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[cartolaFlow] showDestaques:", e.message);
        await ctx.reply("❌ Erro ao buscar destaques. Tente novamente.");
      }

      return { noRender: true };
    },

    // ── Parcial do grupo ──────────────────────────────────────────────────────
    showGroupParcial: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      if (!isGroup) {
        await ctx.reply("📊 A parcial do grupo só está disponível em grupos.");
        return { noRender: true };
      }

      try {
        const { ranking } = await cartolaClient.getGroupParcial(ctx.chatId);

        if (!ranking || !ranking.length) {
          await ctx.reply(
            "📊 *Parcial do grupo*\n\n" +
              "Nenhum membro do grupo vinculou seu time ainda.\n\n" +
              "Cada pessoa deve usar ⚙️ *Configurações → Vincular meu time*.",
          );
          return { noRender: true };
        }

        const medals = ["🥇", "🥈", "🥉"];
        const lines = ["📊 *Parcial do grupo*", ""];

        for (let i = 0; i < ranking.length; i++) {
          const r = ranking[i];
          const pos = medals[i] || `${i + 1}.`;
          lines.push(
            `${pos} ${r.displayName} — *${formatPontuacao(r.pontos)} pts*`,
          );
          lines.push(`    🏠 ${r.teamName}`);
        }

        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[cartolaFlow] showGroupParcial:", e.message);
        await ctx.reply("❌ Erro ao buscar parcial. Tente novamente.");
      }

      return { noRender: true };
    },

    // ── Ranking da liga ───────────────────────────────────────────────────────
    showLeagueRanking: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");

      let groupId = ctx.chatId;
      if (!isGroup) {
        await ctx.reply(
          "🏆 O ranking da liga só está disponível em grupos.\n\nUse */cartola* no grupo que tem a liga vinculada.",
        );
        return { noRender: true };
      }

      try {
        const { slug, liga } = await cartolaClient.getLeagueRanking(groupId);
        const times = liga?.times || liga?.ranking || liga?.ligas_times || [];

        if (!times.length) {
          await ctx.reply(
            `🏆 Liga *${slug}* vinculada, mas sem dados de ranking disponíveis no momento.`,
          );
          return { noRender: true };
        }

        const medals = ["🥇", "🥈", "🥉"];
        const lines = [`🏆 *Ranking — ${liga?.nome || slug}*`, ""];

        for (let i = 0; i < Math.min(times.length, 10); i++) {
          const t = times[i];
          const nome = t.nome || t.time?.nome || `Time ${i + 1}`;
          const pts =
            t.pontos != null ? ` — *${formatPontuacao(t.pontos)} pts*` : "";
          lines.push(`${medals[i] || `${i + 1}.`} ${nome}${pts}`);
        }

        await ctx.reply(lines.join("\n"));
      } catch (e) {
        if (e.message === "no_league_linked") {
          await ctx.reply(
            "🏆 Nenhuma liga vinculada a este grupo.\n\nUse ⚙️ *Configurações → Vincular liga* para adicionar.",
          );
        } else {
          logger.error("[cartolaFlow] getLeagueRanking:", e.message);
          await ctx.reply(
            "❌ Erro ao buscar ranking da liga. Tente novamente.",
          );
        }
      }

      return { noRender: true };
    },

    // ── Rodada atual ──────────────────────────────────────────────────────────
    showRodada: async (ctx) => {
      try {
        const rodada = await cartolaClient.getRodada();
        const lines = [
          "📊 *Rodada atual — Cartola FC*",
          "",
          formatMercadoStatus(rodada),
        ];

        if (rodada.fechamentoMercado) {
          let dtInput = rodada.fechamentoMercado;
          // "2024-11-01 12:00:00" → "2024-11-01T12:00:00" para o construtor Date()
          if (
            typeof dtInput === "string" &&
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(dtInput)
          ) {
            dtInput = dtInput.replace(" ", "T");
          }
          const dt = new Date(typeof dtInput === "number" ? dtInput : dtInput);
          if (!isNaN(dt.getTime())) {
            const dateFmt = dt.toLocaleDateString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              day: "2-digit",
              month: "2-digit",
            });
            const timeFmt = dt.toLocaleTimeString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
            });
            lines.push(`⏰ Fechamento: ${dateFmt} às ${timeFmt}`);
          }
        }

        await ctx.reply(lines.join("\n"));
      } catch (e) {
        logger.error("[cartolaFlow] showRodada:", e.message);
        await ctx.reply("❌ Erro ao buscar dados da rodada.");
      }
      return { noRender: true };
    },

    // ── Config: vincular time ─────────────────────────────────────────────────
    startTeamLink: async (ctx) => {
      if (String(ctx.chatId).endsWith("@g.us")) {
        await ctx.reply(
          "🔗 *Vincular meu time*\n\n" +
            "A vinculação de time é feita apenas no privado.\n\n" +
            "Manda */cartola* pra mim no privado para configurar.",
        );
        return { noRender: true };
      }
      conversationState.startFlow(ctx.userId, "cartola-team-input", {
        step: "await_slug",
        userId: ctx.userId,
      });
      await ctx.reply(
        "🔗 *Vincular meu time*\n\n" +
          "Me manda o número ou slug do seu time.\n\n" +
          "Você encontra na URL do Cartola FC:\n" +
          "_cartola.globo.com/#!/time/*123456*_ → manda o número\n" +
          "_cartola.globo.com/time/*meu-time*_ → manda o slug\n\n" +
          "_(ou /cancelar para sair)_",
      );
      return { end: true };
    },

    // ── Config: vincular liga ─────────────────────────────────────────────────
    startLeagueLink: async (ctx) => {
      const isGroup = String(ctx.chatId).endsWith("@g.us");
      if (!isGroup) {
        await ctx.reply(
          "🏆 A vinculação de liga só pode ser feita dentro do grupo.",
        );
        return { noRender: true };
      }
      conversationState.startFlow(ctx.userId, "cartola-league-input", {
        step: "await_slug",
        userId: ctx.userId,
        groupId: ctx.chatId,
      });
      await ctx.reply(
        "🏆 *Vincular liga ao grupo*\n\n" +
          "Me manda o link ou o slug da sua liga no Cartola FC.\n\n" +
          "Você encontra na URL da liga:\n" +
          "_cartola.globo.com/#!/competicoes/pontoscorridos/*slug*_\n\n" +
          "_(ou /cancelar para sair)_",
      );
      return { end: true };
    },

    // ── Notificações: ligar/desligar sistema ──────────────────────────────────
    toggleNotAtivo: async (ctx) => {
      let s = {};
      try {
        const r = await cartolaClient.getGroupSettings(ctx.chatId);
        s = r?.settings || r || {};
      } catch (e) {
        /* ignore */
      }
      const newVal = !s.active;
      await cartolaClient.saveGroupSettings(ctx.chatId, { active: newVal });
      const msg = newVal
        ? "✅ *Notificações ativadas!*\n\nO bot vai avisar o grupo sobre gols, assistências e mais durante a rodada."
        : "🔕 *Notificações desativadas.*";
      await ctx.reply(msg);
      return { noRender: true };
    },

    // ── Notificações: gol ─────────────────────────────────────────────────────
    toggleNotGol: async (ctx) => {
      let s = {};
      try {
        const r = await cartolaClient.getGroupSettings(ctx.chatId);
        s = r?.settings || r || {};
      } catch (e) {
        /* ignore */
      }
      const newVal = s.notify_gol === false ? true : false;
      await cartolaClient.saveGroupSettings(ctx.chatId, { notify_gol: newVal });
      await ctx.reply(
        newVal
          ? "✅ Notificação de *gol* ligada."
          : "⬜ Notificação de *gol* desligada.",
      );
      return { noRender: true };
    },

    // ── Notificações: assistência ─────────────────────────────────────────────
    toggleNotAssist: async (ctx) => {
      let s = {};
      try {
        const r = await cartolaClient.getGroupSettings(ctx.chatId);
        s = r?.settings || r || {};
      } catch (e) {
        /* ignore */
      }
      const newVal = s.notify_assist === false ? true : false;
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_assist: newVal,
      });
      await ctx.reply(
        newVal
          ? "✅ Notificação de *assistência* ligada."
          : "⬜ Notificação de *assistência* desligada.",
      );
      return { noRender: true };
    },

    // ── Notificações: cartão vermelho ─────────────────────────────────────────
    toggleNotCV: async (ctx) => {
      let s = {};
      try {
        const r = await cartolaClient.getGroupSettings(ctx.chatId);
        s = r?.settings || r || {};
      } catch (e) {
        /* ignore */
      }
      const newVal = s.notify_cartao_vermelho === false ? true : false;
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_cartao_vermelho: newVal,
      });
      await ctx.reply(
        newVal
          ? "✅ Notificação de *cartão vermelho* ligada."
          : "⬜ Notificação de *cartão vermelho* desligada.",
      );
      return { noRender: true };
    },

    // ── Notificações: cartão amarelo ──────────────────────────────────────────
    toggleNotCA: async (ctx) => {
      let s = {};
      try {
        const r = await cartolaClient.getGroupSettings(ctx.chatId);
        s = r?.settings || r || {};
      } catch (e) {
        /* ignore */
      }
      const newVal = !(s.notify_cartao_amarelo === true);
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_cartao_amarelo: newVal,
      });
      await ctx.reply(
        newVal
          ? "✅ Notificação de *cartão amarelo* ligada."
          : "⬜ Notificação de *cartão amarelo* desligada.",
      );
      return { noRender: true };
    },

    // ── Notificações: parcial ─────────────────────────────────────────────────
    setParcial0: async (ctx) => {
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_parcial_interval: null,
      });
      await ctx.reply("🔕 Parcial automática *desligada*.");
      return { noRender: true };
    },
    setParcial30: async (ctx) => {
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_parcial_interval: 30,
      });
      await ctx.reply("✅ Parcial automática a cada *30 min*.");
      return { noRender: true };
    },
    setParcial60: async (ctx) => {
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_parcial_interval: 60,
      });
      await ctx.reply("✅ Parcial automática a cada *60 min*.");
      return { noRender: true };
    },
    setParcial90: async (ctx) => {
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_parcial_interval: 90,
      });
      await ctx.reply("✅ Parcial automática a cada *90 min*.");
      return { noRender: true };
    },

    // ── Notificações: virada ──────────────────────────────────────────────────
    toggleNotVirada: async (ctx) => {
      let s = {};
      try {
        const r = await cartolaClient.getGroupSettings(ctx.chatId);
        s = r?.settings || r || {};
      } catch (e) {
        /* ignore */
      }
      const newVal = s.notify_virada === false ? true : false;
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_virada: newVal,
      });
      await ctx.reply(
        newVal
          ? "✅ Notificação de *virada de liderança* ligada."
          : "⬜ Notificação de *virada de liderança* desligada.",
      );
      return { noRender: true };
    },

    // ── Notificações: resultado final ─────────────────────────────────────────
    toggleNotResultado: async (ctx) => {
      let s = {};
      try {
        const r = await cartolaClient.getGroupSettings(ctx.chatId);
        s = r?.settings || r || {};
      } catch (e) {
        /* ignore */
      }
      const newVal = s.notify_resultado === false ? true : false;
      await cartolaClient.saveGroupSettings(ctx.chatId, {
        notify_resultado: newVal,
      });
      await ctx.reply(
        newVal
          ? "✅ Notificação de *resultado final* ligada."
          : "⬜ Notificação de *resultado final* desligada.",
      );
      return { noRender: true };
    },

    leave: async (ctx) => {
      await ctx.reply("⚽ Até a próxima!");
      return { end: true };
    },
  },
});

module.exports = { cartolaFlow };
