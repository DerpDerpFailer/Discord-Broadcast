"use strict";

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const logger = require("../utils/logger").child("cmd:mute");
const i18n   = require("../i18n");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute ou démute un relay bot (clique sur un bouton pour toggler)")
    .setDescriptionLocalizations({ "en-US": "Mute or unmute a relay bot (click a button to toggle)", "en-GB": "Mute or unmute a relay bot (click a button to toggle)" }),

  async execute(interaction, masterBot) {
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply(buildMutePanel(masterBot, interaction.locale));
  },

  async handleComponent(interaction, masterBot) {
    const relayId    = interaction.customId.split(":")[2];
    const dispatcher = masterBot.dispatcher;
    const bot        = masterBot._relayBots.find((b) => b.relayId === relayId);

    if (!bot) return interaction.update(buildMutePanel(masterBot, interaction.locale));

    if (dispatcher.isRelayMuted(relayId)) {
      dispatcher.unmuteRelay(relayId);
      logger.info("Relay démuté", { relay: bot.name, by: interaction.user.tag });
    } else {
      dispatcher.muteRelay(relayId);
      logger.info("Relay muté", { relay: bot.name, by: interaction.user.tag });
    }

    return interaction.update(buildMutePanel(masterBot, interaction.locale));
  },
};

function buildMutePanel(masterBot, locale) {
  const { t }      = i18n(locale);
  const dispatcher = masterBot.dispatcher;
  const relayBots  = masterBot._relayBots;

  const lines = relayBots.map((bot) => {
    const muted     = dispatcher.isRelayMuted(bot.relayId);
    const connected = bot.getStatus().connected;
    const icon      = muted ? "🔇" : "🔊";
    const state     = muted ? t("mute.stateMuted") : "";
    const warn      = !connected ? " ⚠️" : "";
    return `${icon} **${bot.name}** — <#${bot.channelId}>${state}${warn}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(t("mute.panelTitle"))
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: t("mute.panelFooter") });

  const rows = [];
  for (let i = 0; i < relayBots.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        relayBots.slice(i, i + 5).map((bot) => {
          const muted = dispatcher.isRelayMuted(bot.relayId);
          return new ButtonBuilder()
            .setCustomId(`mute:toggle:${bot.relayId}`)
            .setLabel(muted ? `🔇 ${bot.index}` : `🔊 ${bot.index}`)
            .setStyle(muted ? ButtonStyle.Danger : ButtonStyle.Success);
        })
      )
    );
  }

  return { embeds: [embed], components: rows };
}
