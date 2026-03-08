"use strict";

/**
 * setup.js — Wizard de configuration interactif
 *
 * Étapes :
 *   0 → Accueil
 *   1 → Canal source
 *   2 → Rôle autorisé
 *   3 → Relay bots (un par un, avec modal pour le nom)
 *   4 → Récapitulatif + sauvegarde
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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

  // ── Lancement du wizard ─────────────────────────────────────────────────

  async execute(interaction, masterBot) {
    const userId    = interaction.user.id;
    const relayBots = masterBot._relayBots;
    const saved     = configStore.load();

    // Initialise l'état du wizard avec les valeurs actuelles comme défaut
    wizardStates.set(userId, {
      step:               0,
      sourceChannelId:    saved.sourceChannelId    || config.sourceChannelId    || null,
      roleId:             saved.shotcallerRoleId   || config.shotcallerRoleId   || null,
      currentRelayIndex:  0,
      relayBots: relayBots.map((bot, i) => ({
        channelId: saved.relayBots?.[i]?.channelId || bot.channelId,
        name:      saved.relayBots?.[i]?.name      || bot.name,
      })),
    });

    await interaction.reply({
      ...buildMessage(wizardStates.get(userId), userId, relayBots.length),
      ephemeral: true,
    });

    logger.info("Wizard /setup démarré", { user: interaction.user.tag });
  },

  // ── Gestion des boutons et menus ────────────────────────────────────────

  async handleComponent(interaction, masterBot) {
    const parts   = interaction.customId.split(":");
    const action  = parts[1];
    const userId  = parts[2];
    const relays  = masterBot._relayBots;

    // Sécurité : seul l'utilisateur qui a lancé /setup peut interagir
    if (interaction.user.id !== userId) {
      return interaction.reply({
        content: "❌ Ce n'est pas votre session de configuration.",
        ephemeral: true,
      });
    }

    const state = wizardStates.get(userId);
    if (!state) {
      return interaction.update({
        content: "❌ Session expirée. Relancez `/setup`.",
        embeds: [], components: [],
      });
    }

    // ── Actions ────────────────────────────────────────────────────────

    if (action === "cancel") {
      wizardStates.delete(userId);
      return interaction.update({
        content: "Configuration annulée.",
        embeds: [], components: [],
      });
    }

    if (action === "start") {
      state.step = 1;
      return interaction.update(buildMessage(state, userId, relays.length));
    }

    // Étape 1 — Sélection du canal source (ouvre une modale)
    if (action === "src_channel") {
      const modal = new ModalBuilder()
        .setCustomId(`setup_modal:src_channel:${userId}`)
        .setTitle("Canal source");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("channel_id")
            .setLabel("ID du canal vocal source")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Ex: 1234567890123456789")
            .setValue(state.sourceChannelId || "")
            .setRequired(true)
        )
      );
      return interaction.showModal(modal);
    }

    // Étape 2 — Sélection du rôle
    if (action === "role") {
      state.roleId = interaction.values[0];
      state.step = 3;
      state.currentRelayIndex = 0;
      return interaction.update(buildMessage(state, userId, relays.length));
    }

    // Étape 3 — Canal cible du relay courant (ouvre une modale)
    if (action === "relay_channel") {
      const idx = state.currentRelayIndex;
      const modal = new ModalBuilder()
        .setCustomId(`setup_modal:relay_channel:${userId}`)
        .setTitle(`Canal cible — Relay bot ${idx + 1}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("channel_id")
            .setLabel("ID du canal vocal cible")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Ex: 1234567890123456789")
            .setValue(state.relayBots[idx].channelId || "")
            .setRequired(true)
        )
      );
      return interaction.showModal(modal);
    }

    // Étape 3 — Modifier le nom du relay courant (ouvre une modale)
    if (action === "relay_name") {
      const current = state.relayBots[state.currentRelayIndex];
      const modal = new ModalBuilder()
        .setCustomId(`setup_modal:name:${userId}`)
        .setTitle(`Nom du relay bot ${state.currentRelayIndex + 1}`);

      modal.addComponents(
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

    // Navigation — Précédent
    if (action === "prev") {
      if (state.step === 3 && state.currentRelayIndex > 0) {
        state.currentRelayIndex--;
      } else if (state.step === 3 && state.currentRelayIndex === 0) {
        state.step = 2;
      } else if (state.step === 4) {
        state.step = 3;
        state.currentRelayIndex = relays.length - 1;
      } else {
        state.step = Math.max(0, state.step - 1);
      }
      return interaction.update(buildMessage(state, userId, relays.length));
    }

    // Navigation — Suivant
    if (action === "next") {
      if (state.step === 3) {
        if (state.currentRelayIndex < relays.length - 1) {
          state.currentRelayIndex++;
        } else {
          state.step = 4;
        }
      } else {
        state.step++;
      }
      return interaction.update(buildMessage(state, userId, relays.length));
    }

    // Étape 4 — Sauvegarder
    if (action === "save") {
      const toSave = {
        sourceChannelId:  state.sourceChannelId,
        shotcallerRoleId: state.roleId,
        relayBots: state.relayBots.map((b) => ({
          channelId: b.channelId,
          name:      b.name,
        })),
      };

      configStore.save(toSave);

      // Appliquer immédiatement sans redémarrage
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
            .setDescription(
              "Les changements sont actifs immédiatement.\n" +
              "Relancez `/start` pour appliquer les nouveaux canaux."
            )
            .setColor(0x57f287),
        ],
        components: [],
      });
    }
  },

  // ── Gestion des modales (nom du relay bot) ──────────────────────────────

  async handleModal(interaction, masterBot) {
    const parts  = interaction.customId.split(":");
    const action = parts[1];
    const userId = parts[2];

    const state = wizardStates.get(userId);
    if (!state) {
      return interaction.reply({ content: "❌ Session expirée. Relancez `/setup`.", ephemeral: true });
    }

    // Canal source
    if (action === "src_channel") {
      const channelId = interaction.fields.getTextInputValue("channel_id").trim();
      // Valider que le canal existe
      try {
        const guild   = interaction.guild;
        const channel = await guild.channels.fetch(channelId);
        if (!channel?.isVoiceBased()) {
          return interaction.reply({ content: "❌ Ce canal n'est pas un canal vocal.", ephemeral: true });
        }
        state.sourceChannelId = channelId;
        state.step = 2;
      } catch {
        return interaction.reply({ content: "❌ ID de canal introuvable. Vérifiez l'ID et réessayez.", ephemeral: true });
      }
      await interaction.deferUpdate();
      await interaction.editReply(buildMessage(state, userId, masterBot._relayBots.length));
      return;
    }

    // Canal cible relay
    if (action === "relay_channel") {
      const channelId = interaction.fields.getTextInputValue("channel_id").trim();
      try {
        const guild   = interaction.guild;
        const channel = await guild.channels.fetch(channelId);
        if (!channel?.isVoiceBased()) {
          return interaction.reply({ content: "❌ Ce canal n'est pas un canal vocal.", ephemeral: true });
        }
        state.relayBots[state.currentRelayIndex].channelId = channelId;
      } catch {
        return interaction.reply({ content: "❌ ID de canal introuvable. Vérifiez l'ID et réessayez.", ephemeral: true });
      }
      await interaction.deferUpdate();
      await interaction.editReply(buildMessage(state, userId, masterBot._relayBots.length));
      return;
    }

    // Nom du relay bot
    if (action === "name") {
      state.relayBots[state.currentRelayIndex].name =
        interaction.fields.getTextInputValue("name");
      await interaction.deferUpdate();
      await interaction.editReply(buildMessage(state, userId, masterBot._relayBots.length));
    }
  },
};

// ── Construction des messages du wizard ───────────────────────────────────

function buildMessage(state, userId, relayCount) {
  if (state.step === 0) return buildWelcome(userId);
  if (state.step === 1) return buildSourceChannel(state, userId);
  if (state.step === 2) return buildRole(state, userId);
  if (state.step === 3) return buildRelayBot(state, userId, relayCount);
  if (state.step === 4) return buildSummary(state, userId, relayCount);
}

function buildWelcome(userId) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Configuration du Broadcast")
        .setColor(0x5865f2)
        .setDescription(
          "Cet assistant va vous guider pour configurer le système de broadcast vocal.\n\n" +
          "**Ce que vous allez configurer :**\n" +
          "📥 Canal source (Shotcallers)\n" +
          "🛡️ Rôle autorisé à utiliser les commandes\n" +
          "📢 Canal cible et nom de chaque relay bot"
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:start:${userId}`)
          .setLabel("Démarrer la configuration")
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

function buildSourceChannel(state, userId) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Étape 1/3 — Canal source")
        .setColor(0x5865f2)
        .setDescription(
          "Cliquez sur **Choisir le canal** et entrez l'ID du canal vocal source." +
          "\n\nPour copier un ID : clic droit sur le canal > Copier identifiant" +
          "\n*(Mode developpeur requis : Parametres Discord > Avances)*"
        )
        .addFields({
          name:  "Canal actuel",
          value: state.sourceChannelId ? `<#${state.sourceChannelId}>` : "_Non configuré_",
        }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:src_channel:${userId}`)
          .setLabel("Choisir le canal")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📥"),
        new ButtonBuilder()
          .setCustomId(`setup:cancel:${userId}`)
          .setLabel("Annuler")
          .setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

function buildRole(state, userId) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Étape 2/3 — Rôle autorisé")
        .setColor(0x5865f2)
        .setDescription("Sélectionnez le rôle qui pourra utiliser `/start`, `/stop` et `/status`.")
        .addFields({
          name:  "Rôle actuel",
          value: state.roleId ? `<@&${state.roleId}>` : "_Non configuré_",
        }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`setup:role:${userId}`)
          .setPlaceholder("Choisir le rôle autorisé...")
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:prev:${userId}`)
          .setLabel("Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("◀️"),
        new ButtonBuilder()
          .setCustomId(`setup:cancel:${userId}`)
          .setLabel("Annuler")
          .setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

function buildRelayBot(state, userId, relayCount) {
  const idx      = state.currentRelayIndex;
  const bot      = state.relayBots[idx];
  const isLast   = idx === relayCount - 1;
  const hasChannel = !!bot.channelId;

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`⚙️ Étape 3/3 — Relay bot ${idx + 1}/${relayCount}`)
        .setColor(0x5865f2)
        .setDescription(`Configuration du relay bot **${bot.name}**.`)
        .addFields(
          {
            name:   "📢 Canal cible",
            value:  bot.channelId ? `<#${bot.channelId}>` : "_Non configuré_",
            inline: true,
          },
          {
            name:   "🏷️ Nom",
            value:  bot.name,
            inline: true,
          }
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:relay_channel:${userId}`)
          .setLabel("Choisir le canal")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📢"),
        new ButtonBuilder()
          .setCustomId(`setup:relay_name:${userId}`)
          .setLabel("Modifier le nom")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("✏️"),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:prev:${userId}`)
          .setLabel("Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("◀️"),
        new ButtonBuilder()
          .setCustomId(`setup:next:${userId}`)
          .setLabel(isLast ? "Récapitulatif →" : "Suivant →")
          .setStyle(hasChannel ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(!hasChannel)
      ),
    ],
  };
}

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
          {
            name:  "📥 Canal source",
            value: state.sourceChannelId ? `<#${state.sourceChannelId}>` : "❌ Non configuré",
          },
          {
            name:  "🛡️ Rôle autorisé",
            value: state.roleId ? `<@&${state.roleId}>` : "❌ Non configuré",
          },
          {
            name:  "📢 Relay bots",
            value: relayLines || "_Aucun_",
          }
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
