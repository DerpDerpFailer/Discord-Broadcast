"use strict";

/**
 * setup.js — Wizard de configuration interactif
 *
 * Étapes :
 *   0 → Accueil
 *   1 → Canal source (Shotcallers)
 *   2 → Rôle Shotcaller (peut parler + /start /stop /status)
 *   3 → Rôle Staff (peut /start /stop /status, optionnel)
 *   4 → Relay bots (canal + nom, un par un)
 *   5 → Récapitulatif + sauvegarde
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
      staffRoleId:       saved.staffRoleId        || config.staffRoleId        || null,
      currentRelayIndex: 0,
      relayBots: masterBot._relayBots.map((bot, i) => ({
        channelId: saved.relayBots?.[i]?.channelId || bot.channelId,
        name:      saved.relayBots?.[i]?.name      || bot.name,
      })),
      pendingChannelId:    null,
      pendingChannelName:  null,
      pendingRoleId:       null,
      pendingRoleName:     null,
      // Paramètres avancés (lus depuis config en vigueur)
      adv_silenceThresholdMs:  saved.adv_silenceThresholdMs  ?? config.silenceThresholdMs,
      adv_maxBufferFrames:     saved.adv_maxBufferFrames      ?? config.maxBufferFrames,
      adv_watchdogThresholdMs: saved.adv_watchdogThresholdMs ?? config.watchdogThresholdMs,
      adv_autoDisconnectMs:    saved.adv_autoDisconnectMs     ?? config.autoDisconnectMs,
      adv_logLevel:            saved.adv_logLevel             ?? config.logLevel,
    });

    await interaction.reply({
      ...buildStep(wizardStates.get(userId), userId, masterBot._relayBots.length, interaction.guild),
      ephemeral: true,
    });

    logger.info("Wizard /setup démarré", { user: interaction.user.tag });
  },

  // ── Boutons & Menus ───────────────────────────────────────────────────────

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

    if (action === "cancel") {
      wizardStates.delete(userId);
      return interaction.update({ content: "Configuration annulée.", embeds: [], components: [] });
    }

    if (action === "start") {
      state.step = 1;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Étape 1 : canal source ───────────────────────────────────────────
    if (action === "search_src") {
      return interaction.showModal(buildSearchModal("Nom du canal source", "Ex: Shotcallers", `setup_modal:src_search:${userId}`));
    }
    if (action === "confirm_src") {
      state.sourceChannelId    = state.pendingChannelId;
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      state.step = 2;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }
    if (action === "retry_src") {
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Étape 2 : rôle Shotcaller ────────────────────────────────────────
    if (action === "search_role") {
      return interaction.showModal(buildSearchModal("Nom du rôle Shotcaller", "Ex: Shotcaller", `setup_modal:role_search:${userId}`));
    }
    if (action === "confirm_role") {
      state.roleId           = state.pendingRoleId;
      state.pendingRoleId    = null;
      state.pendingRoleName  = null;
      state.step = 3;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }
    if (action === "retry_role") {
      state.pendingRoleId   = null;
      state.pendingRoleName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Étape 3 : rôle Staff ─────────────────────────────────────────────
    if (action === "search_staff") {
      return interaction.showModal(buildSearchModal("Nom du rôle Staff", "Ex: Staff", `setup_modal:staff_search:${userId}`));
    }
    if (action === "confirm_staff") {
      state.staffRoleId      = state.pendingRoleId;
      state.pendingRoleId    = null;
      state.pendingRoleName  = null;
      state.step = 4;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }
    if (action === "retry_staff") {
      state.pendingRoleId   = null;
      state.pendingRoleName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }
    if (action === "skip_staff") {
      state.staffRoleId = null;
      state.step = 4;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Étape 4 : salon d'alertes ────────────────────────────────────────────
    if (action === "search_alert") {
      return interaction.showModal(buildSearchModal("Nom du salon d'alertes", "Ex: logs-bots", `setup_modal:alert_search:${userId}`));
    }
    if (action === "confirm_alert") {
      state.alertChannelId     = state.pendingChannelId;
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      state.step = 5;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }
    if (action === "retry_alert") {
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }
    if (action === "skip_alert") {
      state.alertChannelId = null;
      state.step = 5;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Étape 5 : relay bots ─────────────────────────────────────────────
    if (action === "search_relay") {
      const idx = state.currentRelayIndex;
      return interaction.showModal(buildSearchModal(
        `Canal pour ${state.relayBots[idx].name}`,
        "Ex: Team 1",
        `setup_modal:relay_search:${userId}`
      ));
    }
    if (action === "confirm_relay") {
      state.relayBots[state.currentRelayIndex].channelId = state.pendingChannelId;
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }
    if (action === "retry_relay") {
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }
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

    // ── Navigation ───────────────────────────────────────────────────────
    if (action === "prev") {
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      state.pendingRoleId      = null;
      state.pendingRoleName    = null;
      if (state.step === 5 && state.currentRelayIndex > 0) {
        state.currentRelayIndex--;
      } else if (state.step === 5 && state.currentRelayIndex === 0) {
        state.step = 4;
      } else if (state.step === 6) {
        state.step = 5;
        state.currentRelayIndex = relayCount - 1;
      } else {
        state.step = Math.max(0, state.step - 1);
      }
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    if (action === "next") {
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      if (state.step === 5) {
        if (state.currentRelayIndex < relayCount - 1) {
          state.currentRelayIndex++;
        } else {
          state.step = 6;
        }
      } else {
        state.step++;
      }
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    // ── Paramètres avancés ───────────────────────────────────────────────
    if (action === "advanced") {
      state._advancedFrom = state.step; // pour revenir
      state.step = 7;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    if (action === "advanced_back") {
      state.step = state._advancedFrom ?? 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild));
    }

    if (action === "advanced_edit") {
      const ms2min = (ms) => ms === 0 ? "0" : String(Math.round(ms / 60000));
      const modal = new ModalBuilder()
        .setCustomId(`setup_modal:advanced:${userId}`)
        .setTitle("Paramètres avancés")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("silence").setLabel("Silence avant arrêt speaker (ms)")
              .setStyle(TextInputStyle.Short).setValue(String(state.adv_silenceThresholdMs)).setRequired(true).setMaxLength(6)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("buffer").setLabel("Max frames en buffer par speaker")
              .setStyle(TextInputStyle.Short).setValue(String(state.adv_maxBufferFrames)).setRequired(true).setMaxLength(4)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("watchdog").setLabel("Watchdog pipeline (ms, 0 = désactivé)")
              .setStyle(TextInputStyle.Short).setValue(String(state.adv_watchdogThresholdMs)).setRequired(true).setMaxLength(8)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("autodisconnect").setLabel("Auto-disconnect inactivité (min, 0 = off)")
              .setStyle(TextInputStyle.Short).setValue(ms2min(state.adv_autoDisconnectMs)).setRequired(true).setMaxLength(6)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("loglevel").setLabel("Niveau de log (error/warn/info/debug)")
              .setStyle(TextInputStyle.Short).setValue(state.adv_logLevel).setRequired(true).setMaxLength(10)
          )
        );
      return interaction.showModal(modal);
    }

    // ── Sauvegarder ──────────────────────────────────────────────────────
    if (action === "save") {
      const toSave = {
        sourceChannelId:  state.sourceChannelId,
        shotcallerRoleId: state.roleId,
        staffRoleId:      state.staffRoleId    || null,
        alertChannelId:   state.alertChannelId || null,
        relayBots: state.relayBots.map((b) => ({ channelId: b.channelId, name: b.name })),
        adv_silenceThresholdMs:  state.adv_silenceThresholdMs,
        adv_maxBufferFrames:     state.adv_maxBufferFrames,
        adv_watchdogThresholdMs: state.adv_watchdogThresholdMs,
        adv_autoDisconnectMs:    state.adv_autoDisconnectMs,
        adv_logLevel:            state.adv_logLevel,
      };
      configStore.save(toSave);

      config.sourceChannelId       = state.sourceChannelId;
      config.shotcallerRoleId      = state.roleId;
      config.staffRoleId           = state.staffRoleId    || null;
      config.alertChannelId        = state.alertChannelId || null;
      config.silenceThresholdMs    = state.adv_silenceThresholdMs;
      config.maxBufferFrames       = state.adv_maxBufferFrames;
      config.watchdogThresholdMs   = state.adv_watchdogThresholdMs;
      config.autoDisconnectMs      = state.adv_autoDisconnectMs;
      config.logLevel              = state.adv_logLevel;
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

    if (action === "src_search") {
      const query   = interaction.fields.getTextInputValue("query").toLowerCase();
      const channel = findVoiceChannel(guild, query);
      state.pendingChannelId   = channel?.id   ?? null;
      state.pendingChannelName = channel?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    if (action === "role_search") {
      const query = interaction.fields.getTextInputValue("query").toLowerCase();
      const role  = findRole(guild, query);
      state.pendingRoleId   = role?.id   ?? null;
      state.pendingRoleName = role?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    if (action === "staff_search") {
      const query = interaction.fields.getTextInputValue("query").toLowerCase();
      const role  = findRole(guild, query);
      state.pendingRoleId   = role?.id   ?? null;
      state.pendingRoleName = role?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    if (action === "alert_search") {
      const query   = interaction.fields.getTextInputValue("query").toLowerCase();
      const channel = findTextChannel(guild, query);
      state.pendingChannelId   = channel?.id   ?? null;
      state.pendingChannelName = channel?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    if (action === "relay_search") {
      const query   = interaction.fields.getTextInputValue("query").toLowerCase();
      const channel = findVoiceChannel(guild, query);
      state.pendingChannelId   = channel?.id   ?? null;
      state.pendingChannelName = channel?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    if (action === "name") {
      state.relayBots[state.currentRelayIndex].name =
        interaction.fields.getTextInputValue("name");
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }

    if (action === "advanced") {
      const parse    = (key, fallback) => { const v = parseInt(interaction.fields.getTextInputValue(key)); return isNaN(v) ? fallback : Math.max(0, v); };
      const parseLog = () => { const v = interaction.fields.getTextInputValue("loglevel").trim().toLowerCase(); return ["error","warn","info","debug"].includes(v) ? v : state.adv_logLevel; };

      state.adv_silenceThresholdMs  = parse("silence",         state.adv_silenceThresholdMs);
      state.adv_maxBufferFrames     = parse("buffer",          state.adv_maxBufferFrames);
      state.adv_watchdogThresholdMs = parse("watchdog",        state.adv_watchdogThresholdMs);
      state.adv_autoDisconnectMs    = parse("autodisconnect",  0) * 60000; // min → ms
      state.adv_logLevel            = parseLog();

      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild));
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function findVoiceChannel(guild, query) {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildVoice && c.name.toLowerCase().includes(query)
  ) || null;
}

function findTextChannel(guild, query) {
  return guild.channels.cache.find(
    (c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
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
  if (state.step === 2) return buildShotcallerRole(state, userId);
  if (state.step === 3) return buildStaffRole(state, userId);
  if (state.step === 4) return buildAlertChannel(state, userId);
  if (state.step === 5) return buildRelayBot(state, userId, relayCount);
  if (state.step === 6) return buildSummary(state, userId, relayCount);
  if (state.step === 7) return buildAdvanced(state, userId);
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
          "2️⃣  Rôle Shotcaller — peut parler + gérer le bot\n" +
          "3️⃣  Rôle Staff — peut gérer le bot (optionnel)\n" +
          "4️⃣  Salon d'alertes (optionnel)\n" +
          "5️⃣  Canal cible de chaque relay bot"
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
          .setCustomId(`setup:advanced:${userId}`)
          .setLabel("Paramètres avancés")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔧"),
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
  if (notFound)    description = `❌ **${state.pendingChannelName}**\nVérifiez l'orthographe et réessayez.`;
  else if (hasPending) description = `J'ai trouvé **#${state.pendingChannelName}**, c'est bien ça ?`;

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
      new ButtonBuilder().setCustomId(`setup:confirm_src:${userId}`).setLabel("✅ Oui, c'est ça !").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_src:${userId}`).setLabel("❌ Non, chercher à nouveau").setStyle(ButtonStyle.Danger)
    ));
  }

  const navRow1 = [new ButtonBuilder().setCustomId(`setup:cancel:${userId}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)];
  if (state.sourceChannelId && !hasPending) navRow1.push(new ButtonBuilder().setCustomId(`setup:next:${userId}`).setLabel("Suivant →").setStyle(ButtonStyle.Primary));
  rows.push(new ActionRowBuilder().addComponents(...navRow1));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Étape 1/5 — Canal source")
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({ name: "Canal configuré", value: state.sourceChannelId ? `<#${state.sourceChannelId}>` : "_Non configuré_" }),
    ],
    components: rows,
  };
}

// ── Étape 2 — Rôle Shotcaller ─────────────────────────────────────────────

function buildShotcallerRole(state, userId) {
  const hasPending = !!state.pendingRoleId;
  const notFound   = state.pendingRoleName?.includes("introuvable");

  let description = "Tapez le nom du rôle **Shotcaller**.\nCe rôle peut parler (broadcasté) et utiliser `/start` `/stop` `/status`.";
  if (notFound)    description = `❌ **${state.pendingRoleName}**\nVérifiez l'orthographe et réessayez.`;
  else if (hasPending) description = `J'ai trouvé le rôle **@${state.pendingRoleName}**, c'est bien ça ?`;

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
      new ButtonBuilder().setCustomId(`setup:confirm_role:${userId}`).setLabel("✅ Oui, c'est ça !").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_role:${userId}`).setLabel("❌ Non, chercher à nouveau").setStyle(ButtonStyle.Danger)
    ));
  }

  const navRow2 = [new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel("Précédent").setStyle(ButtonStyle.Secondary).setEmoji("◀️"), new ButtonBuilder().setCustomId(`setup:cancel:${userId}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)];
  if (state.roleId && !hasPending) navRow2.push(new ButtonBuilder().setCustomId(`setup:next:${userId}`).setLabel("Suivant →").setStyle(ButtonStyle.Primary));
  rows.push(new ActionRowBuilder().addComponents(...navRow2));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Étape 2/5 — Rôle Shotcaller")
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({ name: "🎤 Rôle Shotcaller configuré", value: state.roleId ? `<@&${state.roleId}>` : "_Non configuré_" }),
    ],
    components: rows,
  };
}

// ── Étape 3 — Rôle Staff ─────────────────────────────────────────────────

function buildStaffRole(state, userId) {
  const hasPending = !!state.pendingRoleId;
  const notFound   = state.pendingRoleName?.includes("introuvable");

  let description = "Tapez le nom du rôle **Staff** _(optionnel)_.\nCe rôle peut utiliser `/start` `/stop` `/status`, mais ne sera **pas** broadcasté.";
  if (notFound)    description = `❌ **${state.pendingRoleName}**\nVérifiez l'orthographe et réessayez.`;
  else if (hasPending) description = `J'ai trouvé le rôle **@${state.pendingRoleName}**, c'est bien ça ?`;

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_staff:${userId}`)
        .setLabel("Rechercher un rôle")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm_staff:${userId}`).setLabel("✅ Oui, c'est ça !").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_staff:${userId}`).setLabel("❌ Non, chercher à nouveau").setStyle(ButtonStyle.Danger)
    ));
  }

  const navRow3 = [
    new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel("Précédent").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
    new ButtonBuilder().setCustomId(`setup:skip_staff:${userId}`).setLabel("Ignorer →").setStyle(ButtonStyle.Secondary),
  ];
  if (state.staffRoleId && !hasPending) navRow3.push(new ButtonBuilder().setCustomId(`setup:next:${userId}`).setLabel("Suivant →").setStyle(ButtonStyle.Primary));
  navRow3.push(new ButtonBuilder().setCustomId(`setup:cancel:${userId}`).setLabel("Annuler").setStyle(ButtonStyle.Danger));
  rows.push(new ActionRowBuilder().addComponents(...navRow3));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Étape 3/5 — Rôle Staff (optionnel)")
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({ name: "🛡️ Rôle Staff configuré", value: state.staffRoleId ? `<@&${state.staffRoleId}>` : "_Aucun_" }),
    ],
    components: rows,
  };
}

// ── Étape 4 — Salon d'alertes ────────────────────────────────────────────

function buildAlertChannel(state, userId) {
  const hasPending = !!state.pendingChannelId;
  const notFound   = state.pendingChannelName?.includes("introuvable");

  let description = "Tapez le nom du **salon texte** où envoyer les alertes de déconnexion _(optionnel)_.";
  if (notFound)        description = `❌ **${state.pendingChannelName}**\nVérifiez l'orthographe et réessayez.`;
  else if (hasPending) description = `J'ai trouvé **#${state.pendingChannelName}**, c'est bien ça ?`;

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_alert:${userId}`)
        .setLabel("Rechercher un salon")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm_alert:${userId}`).setLabel("✅ Oui, c'est ça !").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_alert:${userId}`).setLabel("❌ Non, chercher à nouveau").setStyle(ButtonStyle.Danger)
    ));
  }

  const navRow4 = [
    new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel("Précédent").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
    new ButtonBuilder().setCustomId(`setup:skip_alert:${userId}`).setLabel("Ignorer →").setStyle(ButtonStyle.Secondary),
  ];
  if (state.alertChannelId && !hasPending) {
    navRow4.push(new ButtonBuilder().setCustomId(`setup:next:${userId}`).setLabel("Suivant →").setStyle(ButtonStyle.Primary));
  }
  navRow4.push(new ButtonBuilder().setCustomId(`setup:cancel:${userId}`).setLabel("Annuler").setStyle(ButtonStyle.Danger));
  rows.push(new ActionRowBuilder().addComponents(...navRow4));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Étape 4/5 — Salon d'alertes (optionnel)")
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({
          name:  "🔔 Salon configuré",
          value: state.alertChannelId ? `<#${state.alertChannelId}>` : "_Aucun_",
        }),
    ],
    components: rows,
  };
}

// ── Étape 5 — Relay bots ──────────────────────────────────────────────────

function buildRelayBot(state, userId, relayCount) {
  const idx        = state.currentRelayIndex;
  const bot        = state.relayBots[idx];
  const hasPending = !!state.pendingChannelId;
  const notFound   = state.pendingChannelName?.includes("introuvable");
  const isLast     = idx === relayCount - 1;

  let description = `Tapez le nom du canal cible pour **${bot.name}** (ex: Team ${idx + 1}).`;
  if (notFound)    description = `❌ **${state.pendingChannelName}**\nVérifiez l'orthographe et réessayez.`;
  else if (hasPending) description = `J'ai trouvé **#${state.pendingChannelName}**, c'est bien ça ?`;

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
      new ButtonBuilder().setCustomId(`setup:confirm_relay:${userId}`).setLabel("✅ Oui, c'est ça !").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_relay:${userId}`).setLabel("❌ Non, chercher à nouveau").setStyle(ButtonStyle.Danger)
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel("Précédent").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
    new ButtonBuilder().setCustomId(`setup:relay_name:${userId}`).setLabel("✏️ Modifier le nom").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setup:next:${userId}`)
      .setLabel(isLast ? "Récapitulatif →" : "Suivant →")
      .setStyle(bot.channelId ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!bot.channelId)
  ));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`⚙️ Étape 5/5 — Relay bot ${idx + 1}/${relayCount}`)
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields(
          { name: "📢 Canal configuré", value: bot.channelId ? `<#${bot.channelId}>` : "_Non configuré_", inline: true },
          { name: "🏷️ Nom",            value: bot.name,                                                   inline: true }
        ),
    ],
    components: rows,
  };
}

// ── Étape 7 — Paramètres avancés ─────────────────────────────────────────

function buildAdvanced(state, userId) {
  const min2str = (ms) => ms === 0 ? "désactivé" : `${Math.round(ms / 60000)} min`;

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("🔧 Paramètres avancés")
        .setColor(0x5865f2)
        .setDescription(
          "Ces paramètres affectent le comportement audio et la robustesse du système.\n" +
          "Cliquez sur **Modifier** pour changer les valeurs."
        )
        .addFields(
          {
            name:  "🔇 Silence avant arrêt speaker",
            value: `\`${state.adv_silenceThresholdMs} ms\` — délai avant de considérer qu'un speaker a arrêté de parler`,
          },
          {
            name:  "📦 Buffer max par speaker",
            value: `\`${state.adv_maxBufferFrames} frames\` — soit ${state.adv_maxBufferFrames * 20} ms de buffer avant drop`,
          },
          {
            name:  "🐕 Watchdog pipeline",
            value: state.adv_watchdogThresholdMs === 0
              ? "🔴 Désactivé"
              : `🟢 Redémarre si bloqué > \`${state.adv_watchdogThresholdMs} ms\``,
          },
          {
            name:  "💤 Auto-disconnect",
            value: state.adv_autoDisconnectMs === 0
              ? "🔴 Désactivé"
              : `🟢 Arrête le broadcast après \`${min2str(state.adv_autoDisconnectMs)}\` d'inactivité`,
          },
          {
            name:  "📋 Niveau de log",
            value: `\`${state.adv_logLevel}\``,
          }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:advanced_back:${userId}`)
          .setLabel("Retour")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("◀️"),
        new ButtonBuilder()
          .setCustomId(`setup:advanced_edit:${userId}`)
          .setLabel("✏️ Modifier")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

// ── Étape 6 — Récapitulatif ───────────────────────────────────────────────

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
          { name: "📥 Canal source",     value: state.sourceChannelId ? `<#${state.sourceChannelId}>` : "❌ Non configuré" },
          { name: "🎤 Rôle Shotcaller",  value: state.roleId          ? `<@&${state.roleId}>`         : "❌ Non configuré" },
          { name: "🛡️ Rôle Staff",      value: state.staffRoleId    ? `<@&${state.staffRoleId}>`   : "_Aucun_" },
          { name: "🔔 Salon d'alertes",  value: state.alertChannelId ? `<#${state.alertChannelId}>` : "_Aucun_" },
          { name: "📢 Relay bots",       value: relayLines || "_Aucun_" }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel("Précédent").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
        new ButtonBuilder()
          .setCustomId(`setup:advanced:${userId}`)
          .setLabel("🔧 Avancé")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`setup:save:${userId}`)
          .setLabel("💾 Sauvegarder")
          .setStyle(allOk ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(!allOk)
      ),
    ],
  };
}
