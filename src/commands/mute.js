"use strict";

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const logger = require("../utils/logger").child("cmd:mute");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute ou démute un relay bot (clique sur un bouton pour toggler)"),

  // ── Commande slash ────────────────────────────────────────────────────────

  async execute(interaction, masterBot) {
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply(buildMutePanel(masterBot));
  },

  // ── Boutons ───────────────────────────────────────────────────────────────

  async handleComponent(interaction, masterBot) {
    // customId : "mute:toggle:relayId"
    const parts   = interaction.customId.split(":");
    const relayId = parts[2];

    const dispatcher = masterBot.dispatcher;
    const bot        = masterBot._relayBots.find((b) => b.relayId === relayId);

    if (!bot) {
      return interaction.update(buildMutePanel(masterBot));
    }

    if (dispatcher.isRelayMuted(relayId)) {
      dispatcher.unmuteRelay(relayId);
      logger.info("Relay démuté", { relay: bot.name, by: interaction.user.tag });
    } else {
      dispatcher.muteRelay(relayId);
      logger.info("Relay muté", { relay: bot.name, by: interaction.user.tag });
    }

    return interaction.update(buildMutePanel(masterBot));
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function buildMutePanel(masterBot) {
  const dispatcher = masterBot.dispatcher;
  const relayBots  = masterBot._relayBots;

  const lines = relayBots.map((bot) => {
    const muted     = dispatcher.isRelayMuted(bot.relayId);
    const connected = bot.getStatus().connected;
    const icon      = muted ? "🔇" : "🔊";
    const state     = muted ? " _(muté)_" : "";
    const warn      = !connected ? " ⚠️" : "";
    return `${icon} **${bot.name}** — <#${bot.channelId}>${state}${warn}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🔊 État des relay bots")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Cliquez sur un bouton pour muter/démuter" });

  // Max 5 boutons par ActionRow → on découpe par tranches de 5
  const rows = [];
  for (let i = 0; i < relayBots.length; i += 5) {
    const slice = relayBots.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        slice.map((bot) => {
          const muted = dispatcher.isRelayMuted(bot.relayId);
          return new ButtonBuilder()
            .setCustomId(`mute:toggle:${bot.relayId}`)
            .setLabel(muted ? `🔇 ${bot.name}` : `🔊 ${bot.name}`)
            .setStyle(muted ? ButtonStyle.Danger : ButtonStyle.Success);
        })
      )
    );
  }

  return { embeds: [embed], components: rows };
}
