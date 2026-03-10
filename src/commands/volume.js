"use strict";

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const logger = require("../utils/logger").child("cmd:volume");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Ajuste le volume des relay bots (0-200%)"),

  // ── Commande slash ────────────────────────────────────────────────────────

  async execute(interaction, masterBot) {
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply(buildVolumePanel(masterBot));
  },

  // ── Bouton : ouvre la modale ──────────────────────────────────────────────

  async handleComponent(interaction, masterBot) {
    // customId : "volume:edit:relayId"
    const relayId = interaction.customId.split(":")[2];
    const bot     = masterBot._relayBots.find((b) => b.relayId === relayId);
    if (!bot) return interaction.update(buildVolumePanel(masterBot));

    const current = masterBot.dispatcher.getRelayVolume(relayId);

    const modal = new ModalBuilder()
      .setCustomId(`volume_modal:set:${relayId}`)
      .setTitle(`Volume — ${bot.name}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("value")
            .setLabel("Volume % (0=silence · 100=normal · 200=max)")
            .setStyle(TextInputStyle.Short)
            .setValue(String(current))
            .setMinLength(1)
            .setMaxLength(3)
            .setRequired(true)
        )
      );

    return interaction.showModal(modal);
  },

  // ── Modale : applique le volume ───────────────────────────────────────────

  async handleModal(interaction, masterBot) {
    // customId : "volume_modal:set:relayId"
    const relayId = interaction.customId.split(":")[2];
    const bot     = masterBot._relayBots.find((b) => b.relayId === relayId);
    if (!bot) return interaction.deferUpdate();

    const raw   = parseInt(interaction.fields.getTextInputValue("value"));
    const value = isNaN(raw) ? 100 : Math.max(0, Math.min(200, raw));

    masterBot.dispatcher.setRelayVolume(relayId, value);
    logger.info("Volume relay ajusté", { relay: bot.name, value, by: interaction.user.tag });

    await interaction.deferUpdate();
    return interaction.editReply(buildVolumePanel(masterBot));
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function buildVolumePanel(masterBot) {
  const dispatcher = masterBot.dispatcher;
  const relayBots  = masterBot._relayBots;

  const lines = relayBots.map((bot) => {
    const vol   = dispatcher.getRelayVolume(bot.relayId);
    const muted = dispatcher.isRelayMuted(bot.relayId);
    const bar   = volumeBar(vol);
    return `🎚️ **${bot.name}** — <#${bot.channelId}> **${vol}%** ${bar}${muted ? " 🔇" : ""}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🎚️ Volumes des relay bots")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Cliquez sur un bouton pour modifier le volume" });

  // Boutons numérotés 1-N, max 5 par ligne — style identique à /mute
  const rows = [];
  for (let i = 0; i < relayBots.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        relayBots.slice(i, i + 5).map((bot) => {
          const vol   = dispatcher.getRelayVolume(bot.relayId);
          const muted = dispatcher.isRelayMuted(bot.relayId);
          return new ButtonBuilder()
            .setCustomId(`volume:edit:${bot.relayId}`)
            .setLabel(muted ? `🔇 ${bot.index}` : `🔊 ${bot.index}`)
            .setStyle(muted ? ButtonStyle.Danger : ButtonStyle.Success);
        })
      )
    );
  }

  return { embeds: [embed], components: rows };
}

function volumeBar(percent) {
  const filled = Math.round(percent / 20);
  const empty  = 10 - filled;
  return `[${"█".repeat(Math.max(0, filled))}${"░".repeat(Math.max(0, empty))}]`;
}
