"use strict";

/**
 * setup.js — Wizard de configuration interactif
 *
 * Étapes :
 *   0 → Accueil
 *   1 → Canal source (recherche par nom)
 *   2 → Rôle autorisé (recherche par nom)
 *   3 → Relay bots (canal + nom, un par un)
 *   4 → Récapitulatif + sauvegarde
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require("discord.js");

const configStore = require("../config-store");
const config      = require("../config");
const logger      = require("../utils/logger").child("cmd:setup");

// État du wizard par utilisateur (en mémoire, éphémère)
const wizardStates = new Map();

// ── Commande ──────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure le système de broadcast vocal"),

  async execute(interaction, masterBot) {
    const userId = interaction.user.id;
    const saved  = configStore.load();

    wizardStates.set(userId, {
      step:              0,
      sourceChannelId:   saved.sourceChannelId    || config.sourceChannelId    || null,
      roleId:            saved.shotcallerRoleId   || config.shotcallerRoleId   || null,
      currentRelayIndex: 0,
      relayBots: masterBot._relayBots.map((bot, i) => ({
        channelId: saved.relayBots?.[i]?.channelId || bot.channelId,
        name:      saved.relayBots?.[i]?.name      || bot.name,
      })),
      // Résultats de recherche en attente de confirmation
      pendingChannelId: null,
      pendingChannelName: null,
      pendingRoleId: null,
      pendingRoleName: null,
    });

    await interaction.reply({
      ...buildStep(wizardStates.get(userId), userId, masterBot._relayBots.length, interaction.guild),
      ephemeral: true,
    });

    logger.info("Wizard /setup démarré", { user: interaction.user.tag });
  },

  // ── Boutons ───────────────────────────────────────────────────────────────

  async handleComponent(interaction, masterBot) {
    const parts  = interaction.customId.split(":");
    const action = parts[1];
    const userId = parts[2];

    if (interaction.user.id !== userId) {
      return interaction.reply({ content: "❌ Ce n'est pas votre session.", ephemeral: true });
    }

    const state = wizardStates.get(userId);
    if (!state) {
      return interaction.update({ content: "❌ Session expirée. Relancez `/setup`.", embeds: [], components: [] });
    }

    const relayCount = masterBot._relayBots.length;

    // ── Annuler ─────────────────────────────────────────────────────────
    if (action === "cancel") {
      wizardStates.delete(userId);
      return interaction.update({ content: "Configuration annulée.", embeds: [], components: [] });
    }

    // ── Démarrer ────────────────────────────────────────────────────────
    if (action === "start") {
      state.step = 1;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Ouvre modal recherche canal source ──────────────────────────────
    if (action === "search_src") {
      return interaction.showModal(buildSearchModal("Nom du canal source", "Ex: Shotcallers", `setup_modal:src_search:${userId}`));
    }

    // ── Confirmation canal source ────────────────────────────────────────
    if (action === "confirm_src") {
      state.sourceChannelId = state.pendingChannelId;
      state.pendingChannelId = null;
      state.pendingChannelName = null;
      state.step = 2;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Retry canal source ───────────────────────────────────────────────
    if (action === "retry_src") {
      state.pendingChannelId = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Ouvre modal recherche rôle ───────────────────────────────────────
    if (action === "search_role") {
      return interaction.showModal(buildSearchModal("Nom du rôle", "Ex: Shotcaller", `setup_modal:role_search:${userId}`));
    }

    // ── Confirmation rôle ────────────────────────────────────────────────
    if (action === "confirm_role") {
      state.roleId = state.pendingRoleId;
      state.pendingRoleId = null;
      state.pendingRoleName = null;
      state.step = 3;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Retry rôle ───────────────────────────────────────────────────────
    if (action === "retry_role") {
      state.pendingRoleId = null;
      state.pendingRoleName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Ouvre modal recherche canal relay ────────────────────────────────
    if (action === "search_relay") {
      const idx = state.currentRelayIndex;
      return interaction.showModal(buildSearchModal(
        `Canal pour ${state.relayBots[idx].name}`,
        "Ex: Team 1",
        `setup_modal:relay_search:${userId}`
      ));
    }

    // ── Confirmation canal relay ─────────────────────────────────────────
    if (action === "confirm_relay") {
      state.relayBots[state.currentRelayIndex].channelId = state.pendingChannelId;
      state.pendingChannelId = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Retry canal relay ────────────────────────────────────────────────
    if (action === "retry_relay") {
      state.pendingChannelId = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Ouvre modal nom relay ────────────────────────────────────────────
    if (action === "relay_name") {
      const current = state.relayBots[state.currentRelayIndex];
      const modal = new ModalBuilder()
        .setCustomId(`setup_modal:name:${userId}`)
        .setTitle(`Nom du relay bot ${state.currentRelayIndex + 1}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("name")
              .setLabel("Nouveau nom")
              .setStyle(TextInputStyle.Short)
              .setValue(current.name)
              .setMaxLength(32)
              .setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    // ── Navigation Précédent ─────────────────────────────────────────────
    if (action === "prev") {
      state.pendingChannelId = null;
      state.pendingChannelName = null;
      if (state.step === 3 && state.currentRelayIndex > 0) {
        state.currentRelayIndex--;
      } else if (state.step === 3) {
        state.step = 2;
      } else if (state.step === 4) {
        state.step = 3;
        state.currentRelayIndex = relayCount - 1;
      } else {
        state.step = Math.max(0, state.step - 1);
      }
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Navigation Suivant ───────────────────────────────────────────────
    if (action === "next") {
      state.pendingChannelId = null;
      state.pendingChannelName = null;
      if (state.step === 3) {
        if (state.currentRelayIndex < relayCount - 1) {
          state.currentRelayIndex++;
        } else {
          state.step = 4;
        }
      } else {
        state.step++;
      }
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Sauvegarder ──────────────────────────────────────────────────────
    if (action === "save") {
      const toSave = {
        sourceChannelId:  state.sourceChannelId,
        shotcallerRoleId: state.roleId,
        relayBots: state.relayBots.map((b) => ({ channelId: b.channelId, name: b.name })),
      };
      configStore.save(toSave);

      // Appliquer immédiatement
      config.sourceChannelId  = state.sourceChannelId;
      config.shotcallerRoleId = state.roleId;
      state.relayBots.forEach((b, i) => {
        if (masterBot._relayBots[i]) {
          masterBot._relayBots[i].channelId = b.channelId;
          masterBot._relayBots[i].name      = b.name;
        }
      });

      wizardStates.delete(userId);
      logger.info("Configuration sauvegardée via /setup", { user: interaction.user.tag });

      return interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Configuration sauvegardée !")
            .setColor(0x57f287)
            .setDescription(
              "Les changements sont actifs immédiatement.\n" +
              "Relancez `/start` pour appliquer les nouveaux canaux."
            ),
        ],
        components: [],
      });
    }
  },

  // ── Modales ───────────────────────────────────────────────────────────────

  async handleModal(interaction, masterBot) {
    const parts  = interaction.customId.split(":");
    const action = parts[1];
    const userId = parts[2];

    const state = wizardStates.get(userId);
    if (!state) {
      return interaction.reply({ content: "❌ Session expirée. Relancez `/setup`.", ephemeral: true });
    }

    const relayCount = masterBot._relayBots.length;
    const guild      = interaction.guild;

    // ── Recherche canal source ────────────────────────────────────────
    if (action === "src_search") {
      const query   = interaction.fields.getTextInputValue("query").toLowerCase();
      const channel = findVoiceChannel(guild, query);

      if (channel) {
        state.pendingChannelId   = channel.id;
        state.pendingChannelName = channel.name;
      } else {
        state.pendingChannelId   = null;
        state.pendingChannelName = `"${query}" introuvable`;
      }

      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    // ── Recherche rôle ────────────────────────────────────────────────
    if (action === "role_search") {
      const query = interaction.fields.getTextInputValue("query").toLowerCase();
      const role  = findRole(guild, query);

      if (role) {
        state.pendingRoleId   = role.id;
        state.pendingRoleName = role.name;
      } else {
        state.pendingRoleId   = null;
        state.pendingRoleName = `"${query}" introuvable`;
      }

      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    // ── Recherche canal relay ─────────────────────────────────────────
    if (action === "relay_search") {
      const query   = interaction.fields.getTextInputValue("query").toLowerCase();
      const channel = findVoiceChannel(guild, query);

      if (channel) {
        state.pendingChannelId   = channel.id;
        state.pendingChannelName = channel.name;
      } else {
        state.pendingChannelId   = null;
        state.pendingChannelName = `"${query}" introuvable`;
      }

      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    // ── Modifier nom relay ────────────────────────────────────────────
    if (action === "name") {
      state.relayBots[state.currentRelayIndex].name =
        interaction.fields.getTextInputValue("name");
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }
  },
};

// ── Helpers de recherche ──────────────────────────────────────────────────

function findVoiceChannel(guild, query) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildVoice &&
           c.name.toLowerCase().includes(query)
  ) || null;
}

function findRole(guild, query) {
  return guild.roles.cache.find(
    (r) => r.name.toLowerCase().includes(query)
  ) || null;
}

function buildSearchModal(title, placeholder, customId) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Rechercher")
          .setPlaceholder(placeholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50)
      )
    );
}

// ── Construction des étapes ───────────────────────────────────────────────

function buildStep(state, userId, relayCount, guild) {
  if (state.step === 0) return buildWelcome(userId);
  if (state.step === 1) return buildSourceChannel(state, userId);
  if (state.step === 2) return buildRole(state, userId);
  if (state.step === 3) return buildRelayBot(state, userId, relayCount);
  if (state.step === 4) return buildSummary(state, userId, relayCount);
}

// ── Étape 0 — Accueil ─────────────────────────────────────────────────────

function buildWelcome(userId) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Configuration du Broadcast")
        .setColor(0x5865f2)
        .setDescription(
          "Cet assistant va vous guider pour configurer le système.\n\n" +
          "**Étapes :**\n" +
          "1️⃣  Canal source (Shotcallers)\n" +
          "2️⃣  Rôle autorisé\n" +
          "3️⃣  Canal cible de chaque relay bot"
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:start:${userId}`)
          .setLabel("Démarrer")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("⚙️"),
        new ButtonBuilder()
          .setCustomId(`setup:cancel:${userId}`)
          .setLabel("Annuler")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

// ── Étape 1 — Canal source ────────────────────────────────────────────────

function buildSourceChannel(state, userId) {
  const hasPending = !!state.pendingChannelId;
  const notFound   = state.pendingChannelName?.includes("introuvable");

  let description = "Tapez le nom du canal source (ex: **Shotcallers**).";
  if (notFound) {
    description = `❌ **${state.pendingChannelName}**\nVérifiez l'orthographe et réessayez.`;
  } else if (hasPending) {
    description = `J'ai trouvé **#${state.pendingChannelName}**, c'est bien ça ?`;
  }

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_src:${userId}`)
        .setLabel(hasPending && !notFound ? "Chercher à nouveau" : "Rechercher un canal")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:confirm_src:${userId}`)
        .setLabel("✅ Oui, c'est ça !")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`setup:retry_src:${userId}`)
        .setLabel("❌ Non, chercher à nouveau")
        .setStyle(ButtonStyle.Danger)
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:cancel:${userId}`)
      .setLabel("Annuler")
      .setStyle(ButtonStyle.Secondary)
  ));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Étape 1/3 — Canal source")
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({
          name:  "Canal configuré",
          value: state.sourceChannelId ? `<#${state.sourceChannelId}>` : "_Non configuré_",
        }),
    ],
    components: rows,
  };
}

// ── Étape 2 — Rôle ───────────────────────────────────────────────────────

function buildRole(state, userId) {
  const hasPending = !!state.pendingRoleId;
  const notFound   = state.pendingRoleName?.includes("introuvable");

  let description = "Tapez le nom du rôle autorisé (ex: **Shotcaller**).";
  if (notFound) {
    description = `❌ **${state.pendingRoleName}**\nVérifiez l'orthographe et réessayez.`;
  } else if (hasPending) {
    description = `J'ai trouvé le rôle **@${state.pendingRoleName}**, c'est bien ça ?`;
  }

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_role:${userId}`)
        .setLabel("Rechercher un rôle")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:confirm_role:${userId}`)
        .setLabel("✅ Oui, c'est ça !")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`setup:retry_role:${userId}`)
        .setLabel("❌ Non, chercher à nouveau")
        .setStyle(ButtonStyle.Danger)
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:prev:${userId}`)
      .setLabel("Précédent")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
    new ButtonBuilder()
      .setCustomId(`setup:cancel:${userId}`)
      .setLabel("Annuler")
      .setStyle(ButtonStyle.Secondary)
  ));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Étape 2/3 — Rôle autorisé")
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({
          name:  "Rôle configuré",
          value: state.roleId ? `<@&${state.roleId}>` : "_Non configuré_",
        }),
    ],
    components: rows,
  };
}

// ── Étape 3 — Relay bots ─────────────────────────────────────────────────

function buildRelayBot(state, userId, relayCount) {
  const idx        = state.currentRelayIndex;
  const bot        = state.relayBots[idx];
  const hasPending = !!state.pendingChannelId;
  const notFound   = state.pendingChannelName?.includes("introuvable");
  const isLast     = idx === relayCount - 1;

  let description = `Tapez le nom du canal cible pour **${bot.name}** (ex: Team ${idx + 1}).`;
  if (notFound) {
    description = `❌ **${state.pendingChannelName}**\nVérifiez l'orthographe et réessayez.`;
  } else if (hasPending) {
    description = `J'ai trouvé **#${state.pendingChannelName}**, c'est bien ça ?`;
  }

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_relay:${userId}`)
        .setLabel("Rechercher un canal")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:confirm_relay:${userId}`)
        .setLabel("✅ Oui, c'est ça !")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`setup:retry_relay:${userId}`)
        .setLabel("❌ Non, chercher à nouveau")
        .setStyle(ButtonStyle.Danger)
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`setup:prev:${userId}`)
      .setLabel("Précédent")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
    new ButtonBuilder()
      .setCustomId(`setup:relay_name:${userId}`)
      .setLabel("✏️ Modifier le nom")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setup:next:${userId}`)
      .setLabel(isLast ? "Récapitulatif →" : "Suivant →")
      .setStyle(bot.channelId ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!bot.channelId)
  ));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`⚙️ Étape 3/3 — Relay bot ${idx + 1}/${relayCount}`)
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields(
          { name: "📢 Canal configuré", value: bot.channelId ? `<#${bot.channelId}>` : "_Non configuré_", inline: true },
          { name: "🏷️ Nom", value: bot.name, inline: true }
        ),
    ],
    components: rows,
  };
}

// ── Étape 4 — Récapitulatif ───────────────────────────────────────────────

function buildSummary(state, userId, relayCount) {
  const relayLines = state.relayBots
    .slice(0, relayCount)
    .map((b) => `**${b.name}** → ${b.channelId ? `<#${b.channelId}>` : "❌ Non configuré"}`)
    .join("\n");

  const allOk =
    !!state.sourceChannelId &&
    !!state.roleId &&
    state.relayBots.slice(0, relayCount).every((b) => b.channelId);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Récapitulatif")
        .setColor(allOk ? 0x57f287 : 0xfee75c)
        .setDescription(
          allOk
            ? "Tout est configuré. Cliquez sur **Sauvegarder** pour appliquer."
            : "⚠️ Certains éléments ne sont pas encore configurés."
        )
        .addFields(
          { name: "📥 Canal source",    value: state.sourceChannelId ? `<#${state.sourceChannelId}>` : "❌ Non configuré" },
          { name: "🛡️ Rôle autorisé",  value: state.roleId ? `<@&${state.roleId}>` : "❌ Non configuré" },
          { name: "📢 Relay bots",      value: relayLines || "_Aucun_" }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:prev:${userId}`)
          .setLabel("Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("◀️"),
        new ButtonBuilder()
          .setCustomId(`setup:save:${userId}`)
          .setLabel("💾 Sauvegarder")
          .setStyle(allOk ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(!allOk)
      ),
    ],
  };
}
