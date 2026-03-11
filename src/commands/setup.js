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
const i18n        = require("../i18n");

const wizardStates = new Map();

// ── Commande ──────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure le système de broadcast vocal")
    .setDescriptionLocalizations({ "en-US": "Configure the broadcast system", "en-GB": "Configure the broadcast system" }),

  async execute(interaction, masterBot) {
    const userId = interaction.user.id;
    const saved  = configStore.load();

    wizardStates.set(userId, {
      step:              0,
      locale:            interaction.locale,
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
      ...buildStep(wizardStates.get(userId), userId, masterBot._relayBots.length, interaction.guild, wizardStates.get(userId).locale),
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
      return interaction.reply({ content: i18n(interaction.locale).t("setup.notYourSession"), ephemeral: true });
    }

    const state = wizardStates.get(userId);
    if (!state) {
      return interaction.update({ content: i18n(interaction.locale).t("setup.sessionExpired"), embeds: [], components: [] });
    }

    const relayCount = masterBot._relayBots.length;

    if (action === "cancel") {
      wizardStates.delete(userId);
      return interaction.update({ content: i18n(interaction.locale).t("setup.cancelled"), embeds: [], components: [] });
    }

    if (action === "start") {
      state.step = 1;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }

    // ── Étape 1 : canal source ───────────────────────────────────────────
    if (action === "search_src") {
      return interaction.showModal(buildSearchModal(i18n(state.locale).t("setup.step1.modalTitle"), i18n(state.locale).t("setup.step1.modalPh"), `setup_modal:src_search:${userId}`, state.locale));
    }
    if (action === "confirm_src") {
      state.sourceChannelId    = state.pendingChannelId;
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      state.step = 2;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }
    if (action === "retry_src") {
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }

    // ── Étape 2 : rôle Shotcaller ────────────────────────────────────────
    if (action === "search_role") {
      return interaction.showModal(buildSearchModal(i18n(state.locale).t("setup.step2.modalTitle"), i18n(state.locale).t("setup.step2.modalPh"), `setup_modal:role_search:${userId}`, state.locale));
    }
    if (action === "confirm_role") {
      state.roleId           = state.pendingRoleId;
      state.pendingRoleId    = null;
      state.pendingRoleName  = null;
      state.step = 3;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }
    if (action === "retry_role") {
      state.pendingRoleId   = null;
      state.pendingRoleName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }

    // ── Étape 3 : rôle Staff ─────────────────────────────────────────────
    if (action === "search_staff") {
      return interaction.showModal(buildSearchModal(i18n(state.locale).t("setup.step3.modalTitle"), i18n(state.locale).t("setup.step3.modalPh"), `setup_modal:staff_search:${userId}`, state.locale));
    }
    if (action === "confirm_staff") {
      state.staffRoleId      = state.pendingRoleId;
      state.pendingRoleId    = null;
      state.pendingRoleName  = null;
      state.step = 4;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }
    if (action === "retry_staff") {
      state.pendingRoleId   = null;
      state.pendingRoleName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }
    if (action === "skip_staff") {
      state.staffRoleId = null;
      state.step = 4;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }

    // ── Étape 4 : salon d'alertes ────────────────────────────────────────────
    if (action === "search_alert") {
      return interaction.showModal(buildSearchModal(i18n(state.locale).t("setup.step4.modalTitle"), i18n(state.locale).t("setup.step4.modalPh"), `setup_modal:alert_search:${userId}`, state.locale));
    }
    if (action === "confirm_alert") {
      state.alertChannelId     = state.pendingChannelId;
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      state.step = 5;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }
    if (action === "retry_alert") {
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }
    if (action === "skip_alert") {
      state.alertChannelId = null;
      state.step = 5;
      state.currentRelayIndex = 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }

    // ── Étape 5 : relay bots ─────────────────────────────────────────────
    if (action === "search_relay") {
      const idx = state.currentRelayIndex;
      return interaction.showModal(buildSearchModal(
        i18n(state.locale).t("setup.step5.modalTitle", { name: state.relayBots[idx].name }),
        i18n(state.locale).t("setup.step5.modalPh", { index: idx + 1 }),
        `setup_modal:relay_search:${userId}`,
        state.locale
      ));
    }
    if (action === "confirm_relay") {
      state.relayBots[state.currentRelayIndex].channelId = state.pendingChannelId;
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }
    if (action === "retry_relay") {
      state.pendingChannelId   = null;
      state.pendingChannelName = null;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }
    if (action === "relay_name") {
      const current = state.relayBots[state.currentRelayIndex];
      const modal = new ModalBuilder()
        .setCustomId(`setup_modal:name:${userId}`)
        .setTitle(i18n(interaction.locale).t("setup.step5.nameModal", { index: state.currentRelayIndex + 1 }))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("name")
              .setLabel(i18n(interaction.locale).t("setup.step5.nameLabel"))
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
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
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
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }

    // ── Paramètres avancés ───────────────────────────────────────────────
    if (action === "advanced") {
      state._advancedFrom = state.step; // pour revenir
      state.step = 7;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }

    if (action === "advanced_back") {
      state.step = state._advancedFrom ?? 0;
      return interaction.update(buildStep(state, userId, relayCount, interaction.guild, state.locale));
    }

    if (action === "advanced_save") {
      // Charger la config existante pour ne pas écraser les autres champs
      const existing = configStore.load();
      const toSave = {
        ...existing,
        adv_silenceThresholdMs:  state.adv_silenceThresholdMs,
        adv_maxBufferFrames:     state.adv_maxBufferFrames,
        adv_watchdogThresholdMs: state.adv_watchdogThresholdMs,
        adv_autoDisconnectMs:    state.adv_autoDisconnectMs,
        adv_logLevel:            state.adv_logLevel,
      };
      configStore.save(toSave);

      config.silenceThresholdMs  = state.adv_silenceThresholdMs;
      config.maxBufferFrames     = state.adv_maxBufferFrames;
      config.watchdogThresholdMs = state.adv_watchdogThresholdMs;
      config.autoDisconnectMs    = state.adv_autoDisconnectMs;
      config.logLevel            = state.adv_logLevel;

      wizardStates.delete(userId);
      logger.info("Paramètres avancés sauvegardés via /setup", { user: interaction.user.tag });

      return interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle(i18n(interaction.locale).t("setup.advanced.saved"))
            .setColor(0x57f287)
            .setDescription(i18n(interaction.locale).t("setup.advanced.savedDesc")),
        ],
        components: [],
      });
    }

    if (action === "advanced_edit") {
      const ms2min = (ms) => ms === 0 ? "0" : String(Math.round(ms / 60000));
      const modal = new ModalBuilder()
        .setCustomId(`setup_modal:advanced:${userId}`)
        .setTitle(i18n(interaction.locale).t("setup.advanced.modalTitle"))
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("silence").setLabel(i18n(interaction.locale).t("setup.advanced.labelSilence"))
              .setStyle(TextInputStyle.Short).setValue(String(state.adv_silenceThresholdMs)).setRequired(true).setMaxLength(6)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("buffer").setLabel(i18n(interaction.locale).t("setup.advanced.labelBuffer"))
              .setStyle(TextInputStyle.Short).setValue(String(state.adv_maxBufferFrames)).setRequired(true).setMaxLength(4)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("watchdog").setLabel(i18n(interaction.locale).t("setup.advanced.labelWatchdog"))
              .setStyle(TextInputStyle.Short).setValue(String(state.adv_watchdogThresholdMs)).setRequired(true).setMaxLength(8)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("autodisconnect").setLabel(i18n(interaction.locale).t("setup.advanced.labelAutoDisc"))
              .setStyle(TextInputStyle.Short).setValue(ms2min(state.adv_autoDisconnectMs)).setRequired(true).setMaxLength(6)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("loglevel").setLabel(i18n(interaction.locale).t("setup.advanced.labelLog"))
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
            .setTitle(i18n(interaction.locale).t("setup.saved"))
            .setColor(0x57f287)
            .setDescription(i18n(interaction.locale).t("setup.savedDesc")),
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
      return interaction.editReply(buildStep(state, userId, relayCount, guild, state.locale));
    }

    if (action === "role_search") {
      const query = interaction.fields.getTextInputValue("query").toLowerCase();
      const role  = findRole(guild, query);
      state.pendingRoleId   = role?.id   ?? null;
      state.pendingRoleName = role?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild, state.locale));
    }

    if (action === "staff_search") {
      const query = interaction.fields.getTextInputValue("query").toLowerCase();
      const role  = findRole(guild, query);
      state.pendingRoleId   = role?.id   ?? null;
      state.pendingRoleName = role?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild, state.locale));
    }

    if (action === "alert_search") {
      const query   = interaction.fields.getTextInputValue("query").toLowerCase();
      const channel = findTextChannel(guild, query);
      state.pendingChannelId   = channel?.id   ?? null;
      state.pendingChannelName = channel?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild, state.locale));
    }

    if (action === "relay_search") {
      const query   = interaction.fields.getTextInputValue("query").toLowerCase();
      const channel = findVoiceChannel(guild, query);
      state.pendingChannelId   = channel?.id   ?? null;
      state.pendingChannelName = channel?.name ?? `"${query}" introuvable`;
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild, state.locale));
    }

    if (action === "name") {
      state.relayBots[state.currentRelayIndex].name =
        interaction.fields.getTextInputValue("name");
      await interaction.deferUpdate();
      return interaction.editReply(buildStep(state, userId, relayCount, guild, state.locale));
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
      return interaction.editReply(buildStep(state, userId, relayCount, guild, state.locale));
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

function buildSearchModal(title, placeholder, customId, locale) {
  const { t } = i18n(locale);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel(t("setup.searchModal.label"))
          .setPlaceholder(placeholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50)
      )
    );
}

// ── Construction des étapes ───────────────────────────────────────────────

function buildStep(state, userId, relayCount, guild, locale) {
  if (state.step === 0) return buildWelcome(userId, locale);
  if (state.step === 1) return buildSourceChannel(state, userId, locale);
  if (state.step === 2) return buildShotcallerRole(state, userId, locale);
  if (state.step === 3) return buildStaffRole(state, userId, locale);
  if (state.step === 4) return buildAlertChannel(state, userId, locale);
  if (state.step === 5) return buildRelayBot(state, userId, relayCount, locale);
  if (state.step === 6) return buildSummary(state, userId, relayCount, locale);
  if (state.step === 7) return buildAdvanced(state, userId, locale);
}

// ── Étape 0 — Accueil ─────────────────────────────────────────────────────

function buildWelcome(userId, locale) {
  const { t } = i18n(locale);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(t("setup.welcome.title"))
        .setColor(0x5865f2)
        .setDescription(t("setup.welcome.description")),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:start:${userId}`)
          .setLabel(t("setup.welcome.btnStart"))
          .setStyle(ButtonStyle.Primary)
          .setEmoji("⚙️"),
        new ButtonBuilder()
          .setCustomId(`setup:advanced:${userId}`)
          .setLabel(t("setup.welcome.btnAdvanced"))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔧"),
        new ButtonBuilder()
          .setCustomId(`setup:cancel:${userId}`)
          .setLabel(t("setup.welcome.btnCancel"))
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

// ── Étape 1 — Canal source ────────────────────────────────────────────────

function buildSourceChannel(state, userId, locale) {
  const { t } = i18n(locale);
  const hasPending = !!state.pendingChannelId;
  const notFound   = state.pendingChannelName?.includes("introuvable");

  let description = t("setup.step1.description");
  if (notFound)        description = t("setup.step1.notFound", { name: state.pendingChannelName });
  else if (hasPending) description = t("setup.step1.found",    { name: state.pendingChannelName });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_src:${userId}`)
        .setLabel(hasPending && !notFound ? t("setup.step1.btnResearch") : t("setup.step1.btnSearch"))
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm_src:${userId}`).setLabel(t("setup.step1.btnConfirm")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_src:${userId}`).setLabel(t("setup.step1.btnRetry")).setStyle(ButtonStyle.Danger)
    ));
  }

  const navRow1 = [new ButtonBuilder().setCustomId(`setup:cancel:${userId}`).setLabel(t("setup.step1.btnCancel")).setStyle(ButtonStyle.Secondary)];
  if (state.sourceChannelId && !hasPending) navRow1.push(new ButtonBuilder().setCustomId(`setup:next:${userId}`).setLabel(t("setup.step1.btnNext")).setStyle(ButtonStyle.Primary));
  rows.push(new ActionRowBuilder().addComponents(...navRow1));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(t("setup.step1.title"))
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({ name: t("setup.step1.fieldName"), value: state.sourceChannelId ? `<#${state.sourceChannelId}>` : t("setup.step1.notSet") }),
    ],
    components: rows,
  };
}

// ── Étape 2 — Rôle Shotcaller ─────────────────────────────────────────────

function buildShotcallerRole(state, userId, locale) {
  const { t } = i18n(locale);
  const hasPending = !!state.pendingRoleId;
  const notFound   = state.pendingRoleName?.includes("introuvable");

  let description = t("setup.step2.description");
  if (notFound)        description = t("setup.step2.notFound", { name: state.pendingRoleName });
  else if (hasPending) description = t("setup.step2.found",    { name: state.pendingRoleName });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_role:${userId}`)
        .setLabel(t("setup.step2.btnSearch"))
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm_role:${userId}`).setLabel(t("setup.step2.btnConfirm")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_role:${userId}`).setLabel(t("setup.step2.btnRetry")).setStyle(ButtonStyle.Danger)
    ));
  }

  const navRow2 = [new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel(t("setup.step2.btnPrev")).setStyle(ButtonStyle.Secondary).setEmoji("◀️"), new ButtonBuilder().setCustomId(`setup:cancel:${userId}`).setLabel(t("setup.step2.btnCancel")).setStyle(ButtonStyle.Secondary)];
  if (state.roleId && !hasPending) navRow2.push(new ButtonBuilder().setCustomId(`setup:next:${userId}`).setLabel(t("setup.step2.btnNext")).setStyle(ButtonStyle.Primary));
  rows.push(new ActionRowBuilder().addComponents(...navRow2));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(t("setup.step2.title"))
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({ name: t("setup.step2.fieldName"), value: state.roleId ? `<@&${state.roleId}>` : t("setup.step2.notSet") }),
    ],
    components: rows,
  };
}

// ── Étape 3 — Rôle Staff ─────────────────────────────────────────────────

function buildStaffRole(state, userId, locale) {
  const { t } = i18n(locale);
  const hasPending = !!state.pendingRoleId;
  const notFound   = state.pendingRoleName?.includes("introuvable");

  let description = t("setup.step3.description");
  if (notFound)        description = t("setup.step3.notFound", { name: state.pendingRoleName });
  else if (hasPending) description = t("setup.step3.found",    { name: state.pendingRoleName });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_staff:${userId}`)
        .setLabel(t("setup.step3.btnSearch"))
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm_staff:${userId}`).setLabel(t("setup.step3.btnConfirm")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_staff:${userId}`).setLabel(t("setup.step3.btnRetry")).setStyle(ButtonStyle.Danger)
    ));
  }

  const navRow3 = [
    new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel(t("setup.step3.btnPrev")).setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
    new ButtonBuilder().setCustomId(`setup:skip_staff:${userId}`).setLabel(t("setup.step3.btnSkip")).setStyle(ButtonStyle.Secondary),
  ];
  if (state.staffRoleId && !hasPending) navRow3.push(new ButtonBuilder().setCustomId(`setup:next:${userId}`).setLabel(t("setup.step3.btnNext")).setStyle(ButtonStyle.Primary));
  navRow3.push(new ButtonBuilder().setCustomId(`setup:cancel:${userId}`).setLabel(t("setup.step3.btnCancel")).setStyle(ButtonStyle.Danger));
  rows.push(new ActionRowBuilder().addComponents(...navRow3));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(t("setup.step3.title"))
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({ name: t("setup.step3.fieldName"), value: state.staffRoleId ? `<@&${state.staffRoleId}>` : t("setup.step3.notSet") }),
    ],
    components: rows,
  };
}

// ── Étape 4 — Salon d'alertes ────────────────────────────────────────────

function buildAlertChannel(state, userId, locale) {
  const { t } = i18n(locale);
  const hasPending = !!state.pendingChannelId;
  const notFound   = state.pendingChannelName?.includes("introuvable");

  let description = t("setup.step4.description");
  if (notFound)        description = t("setup.step4.notFound", { name: state.pendingChannelName });
  else if (hasPending) description = t("setup.step4.found",    { name: state.pendingChannelName });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_alert:${userId}`)
        .setLabel(t("setup.step4.btnSearch"))
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm_alert:${userId}`).setLabel(t("setup.step4.btnConfirm")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_alert:${userId}`).setLabel(t("setup.step4.btnRetry")).setStyle(ButtonStyle.Danger)
    ));
  }

  const navRow4 = [
    new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel(t("setup.step4.btnPrev")).setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
    new ButtonBuilder().setCustomId(`setup:skip_alert:${userId}`).setLabel(t("setup.step4.btnSkip")).setStyle(ButtonStyle.Secondary),
  ];
  if (state.alertChannelId && !hasPending) {
    navRow4.push(new ButtonBuilder().setCustomId(`setup:next:${userId}`).setLabel(t("setup.step4.btnNext")).setStyle(ButtonStyle.Primary));
  }
  navRow4.push(new ButtonBuilder().setCustomId(`setup:cancel:${userId}`).setLabel(t("setup.step4.btnCancel")).setStyle(ButtonStyle.Danger));
  rows.push(new ActionRowBuilder().addComponents(...navRow4));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(t("setup.step4.title"))
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields({
          name:  t("setup.step4.fieldName"),
          value: state.alertChannelId ? `<#${state.alertChannelId}>` : t("setup.step4.notSet"),
        }),
    ],
    components: rows,
  };
}

// ── Étape 5 — Relay bots ──────────────────────────────────────────────────

function buildRelayBot(state, userId, relayCount, locale) {
  const { t } = i18n(locale);
  const idx        = state.currentRelayIndex;
  const bot        = state.relayBots[idx];
  const hasPending = !!state.pendingChannelId;
  const notFound   = state.pendingChannelName?.includes("introuvable");
  const isLast     = idx === relayCount - 1;

  let description = t("setup.step5.description", { name: bot.name, index: idx + 1 });
  if (notFound)        description = t("setup.step5.notFound", { name: state.pendingChannelName });
  else if (hasPending) description = t("setup.step5.found",    { name: state.pendingChannelName });

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`setup:search_relay:${userId}`)
        .setLabel(t("setup.step5.btnSearch"))
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔍"),
    ),
  ];

  if (hasPending && !notFound) {
    rows.unshift(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup:confirm_relay:${userId}`).setLabel(t("setup.step5.btnConfirm")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`setup:retry_relay:${userId}`).setLabel(t("setup.step5.btnRetry")).setStyle(ButtonStyle.Danger)
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel(t("setup.step5.btnPrev")).setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
    new ButtonBuilder().setCustomId(`setup:relay_name:${userId}`).setLabel(t("setup.step5.btnName")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`setup:next:${userId}`)
      .setLabel(isLast ? t("setup.step5.btnSummary") : t("setup.step5.btnNext"))
      .setStyle(bot.channelId ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!bot.channelId)
  ));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(t("setup.step5.title", { index: idx + 1, total: relayCount }))
        .setColor(notFound ? 0xed4245 : hasPending ? 0xfee75c : 0x5865f2)
        .setDescription(description)
        .addFields(
          { name: t("setup.step5.fieldChan"), value: bot.channelId ? `<#${bot.channelId}>` : t("setup.step5.notSet"), inline: true },
          { name: t("setup.step5.fieldName"), value: bot.name, inline: true }
        ),
    ],
    components: rows,
  };
}

// ── Étape 7 — Paramètres avancés ─────────────────────────────────────────

function buildAdvanced(state, userId, locale) {
  const { t } = i18n(locale);
  const min2str = (ms) => ms === 0 ? "désactivé" : `${Math.round(ms / 60000)} min`;

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(t("setup.advanced.title"))
        .setColor(0x5865f2)
        .setDescription(t("setup.advanced.description"))
        .addFields(
          { name: t("setup.advanced.silence"), value: t("setup.advanced.silenceVal", { ms: state.adv_silenceThresholdMs }) },
          { name: t("setup.advanced.buffer"),  value: t("setup.advanced.bufferVal",  { frames: state.adv_maxBufferFrames, ms: state.adv_maxBufferFrames * 20 }) },
          {
            name:  t("setup.advanced.watchdog"),
            value: state.adv_watchdogThresholdMs === 0
              ? t("setup.advanced.watchdogOff")
              : t("setup.advanced.watchdogOn", { ms: state.adv_watchdogThresholdMs }),
          },
          {
            name:  t("setup.advanced.autodiscon"),
            value: state.adv_autoDisconnectMs === 0
              ? t("setup.advanced.autodisconOff")
              : t("setup.advanced.autodisconOn", { time: min2str(state.adv_autoDisconnectMs) }),
          },
          { name: t("setup.advanced.loglevel"), value: `\`${state.adv_logLevel}\`` }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:advanced_back:${userId}`)
          .setLabel(t("setup.advanced.btnBack"))
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("◀️"),
        new ButtonBuilder()
          .setCustomId(`setup:advanced_edit:${userId}`)
          .setLabel(t("setup.advanced.btnEdit"))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`setup:advanced_save:${userId}`)
          .setLabel(t("setup.advanced.btnSave"))
          .setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

// ── Étape 6 — Récapitulatif ───────────────────────────────────────────────

function buildSummary(state, userId, relayCount, locale) {
  const { t } = i18n(locale);
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
        .setTitle(t("setup.summary.title"))
        .setColor(allOk ? 0x57f287 : 0xfee75c)
        .setDescription(allOk ? t("setup.summary.descOk") : t("setup.summary.descWarning"))
        .addFields(
          { name: t("setup.summary.fieldSource"), value: state.sourceChannelId ? `<#${state.sourceChannelId}>` : t("setup.summary.notSet") },
          { name: t("setup.summary.fieldRole"),   value: state.roleId          ? `<@&${state.roleId}>`         : t("setup.summary.notSet") },
          { name: t("setup.summary.fieldStaff"),  value: state.staffRoleId    ? `<@&${state.staffRoleId}>`   : t("setup.summary.none") },
          { name: t("setup.summary.fieldAlert"),  value: state.alertChannelId ? `<#${state.alertChannelId}>` : t("setup.summary.none") },
          { name: t("setup.summary.fieldRelays"), value: relayLines || t("setup.summary.none") }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup:prev:${userId}`).setLabel(t("setup.summary.btnPrev")).setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
        new ButtonBuilder()
          .setCustomId(`setup:advanced:${userId}`)
          .setLabel(t("setup.summary.btnAdvanced"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`setup:save:${userId}`)
          .setLabel(t("setup.summary.btnSave"))
          .setStyle(allOk ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(!allOk)
      ),
    ],
  };
}
