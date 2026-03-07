"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:status");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Affiche le statut du système de broadcast"),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {import('../master-bot')} masterBot
   */
  async execute(interaction, masterBot) {
    await interaction.deferReply({ ephemeral: true });

    const master     = masterBot.getStatus();
    const dispatcher = masterBot.dispatcher.getStats();
    const relayBots  = masterBot._relayBots || [];

    const isLive = master.broadcasting;
    const uptime = Math.round(dispatcher.uptimeMs / 1000);

    const embed = new EmbedBuilder()
      .setTitle(`${isLive ? "🟢" : "🔴"} Discord Broadcast — Status`)
      .setColor(isLive ? 0x57f287 : 0xed4245)
      .setTimestamp()
      .addFields(
        {
          name:   "📡 Statut",
          value:  isLive ? "En cours" : "Arrêté",
          inline: true,
        },
        {
          name:   "⏱️ Uptime",
          value:  isLive ? `${uptime}s` : "—",
          inline: true,
        },
        {
          name:   "📊 Frames",
          value:  `Envoyées: ${dispatcher.totalFramesDispatched.toLocaleString()}\nPerdues: ${dispatcher.totalFramesDropped}`,
          inline: true,
        },
        {
          name:  "🎤 Speakers actifs",
          value: master.activeSpeakers.length > 0
            ? master.activeSpeakers.map((id) => `<@${id}>`).join(", ")
            : "_Aucun_",
        }
      );

    if (relayBots.length > 0) {
      const lines = relayBots.map((bot) => {
        const s    = bot.getStatus();
        const icon = s.broadcasting ? "✅" : "❌";
        const buf  = s.queueDepth > 0 ? ` _(buf: ${s.queueDepth})_` : "";
        return `${icon} **${s.name}** — <#${s.channelId}>${buf}`;
      });

      embed.addFields({
        name:  `📢 Relay Bots (${relayBots.length})`,
        value: lines.join("\n"),
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logger.info("Status affiché", { user: interaction.user.tag });
  },
};
