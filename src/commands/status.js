"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:status");
const i18n   = require("../i18n");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Affiche le statut du système de broadcast")
    .setDescriptionLocalizations({ "en-US": "Show the broadcast system status", "en-GB": "Show the broadcast system status" }),

  async execute(interaction, masterBot) {
    await interaction.deferReply({ ephemeral: true });
    const { t } = i18n(interaction.locale);

    const master     = masterBot.getStatus();
    const dispatcher = masterBot.dispatcher.getStats();
    const relayBots  = masterBot._relayBots || [];
    const isLive     = master.broadcasting;
    const uptime     = Math.round(dispatcher.uptimeMs / 1000);
    const dropRate   = dispatcher.totalFramesDispatched > 0
      ? ((dispatcher.totalFramesDropped / dispatcher.totalFramesDispatched) * 100).toFixed(2)
      : "0.00";

    const embed = new EmbedBuilder()
      .setTitle(t("status.title", { icon: isLive ? "🟢" : "🔴" }))
      .setColor(isLive ? 0x57f287 : 0xed4245)
      .setTimestamp()
      .addFields(
        { name: t("status.fieldStatus"),     value: isLive ? t("status.live") : t("status.stopped"), inline: true },
        { name: t("status.fieldUptime"),     value: isLive ? `${uptime}s` : "—", inline: true },
        { name: t("status.fieldSource"),     value: master.connectionStatus ?? "—", inline: true },
        {
          name:   t("status.fieldFrames"),
          value:  [
            t("status.framesSent", { count: dispatcher.totalFramesDispatched.toLocaleString() }),
            t("status.framesLost", { count: dispatcher.totalFramesDropped.toLocaleString(), rate: dropRate }),
          ].join("\n"),
          inline: true,
        },
        {
          name:   t("status.fieldSpeakers"),
          value:  master.activeSpeakers.length > 0
            ? master.activeSpeakers.map((id) => `<@${id}>`).join(", ")
            : t("status.noSpeakers"),
          inline: true,
        },
        { name: t("status.fieldReconnects"), value: String(master.reconnectAttempts ?? 0), inline: true }
      );

    if (relayBots.length > 0) {
      const lines = relayBots.map((bot) => {
        const s = bot.getStatus();
        let icon;
        if (s.connected && s.registered)         icon = "🟢";
        else if (s.broadcasting && !s.connected) icon = "🟡";
        else                                      icon = "🔴";

        const parts = [`${icon} **${s.name}** — <#${s.channelId}>`];
        if (!s.connected && s.broadcasting)
          parts.push(t("status.relayReconNote", { count: s.reconnectAttempts }));
        if (s.reconnectAttempts >= 3 && s.broadcasting)
          parts.push(t("status.relayAlertNote", { count: s.reconnectAttempts }));
        if (s.queueDepth > 0)
          parts.push(`_buf: ${s.queueDepth}_`);
        return parts.join(" ");
      });

      const online  = relayBots.filter((b) => b.getStatus().connected).length;
      const recon   = relayBots.filter((b) => { const s = b.getStatus(); return s.broadcasting && !s.connected; }).length;
      const offline = relayBots.length - online - recon;

      const summaryParts = [t("status.relayOnline", { count: online })];
      if (recon   > 0) summaryParts.push(t("status.relayRecon",   { count: recon }));
      if (offline > 0) summaryParts.push(t("status.relayOffline", { count: offline }));

      embed.addFields({
        name:  t("status.relaysTitle", { summary: summaryParts.join(" · ") }),
        value: lines.join("\n"),
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logger.info("Status affiché", { user: interaction.user.tag });
  },
};
