"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:status");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Affiche le statut du système de broadcast"),

  async execute(interaction, masterBot) {
    await interaction.deferReply({ ephemeral: true });

    const master     = masterBot.getStatus();
    const dispatcher = masterBot.dispatcher.getStats();
    const relayBots  = masterBot._relayBots || [];
    const isLive     = master.broadcasting;
    const uptime     = Math.round(dispatcher.uptimeMs / 1000);
    const dropRate   = dispatcher.totalFramesDispatched > 0
      ? ((dispatcher.totalFramesDropped / dispatcher.totalFramesDispatched) * 100).toFixed(2)
      : "0.00";

    // ── Embed principal ───────────────────────────────────────────────

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
          name:   "🔗 Source",
          value:  master.connectionStatus ?? "—",
          inline: true,
        },
        {
          name:   "📊 Frames",
          value:  [
            `Envoyées : ${dispatcher.totalFramesDispatched.toLocaleString()}`,
            `Perdues  : ${dispatcher.totalFramesDropped.toLocaleString()} (${dropRate}%)`,
          ].join("\n"),
          inline: true,
        },
        {
          name:   "🎤 Speakers actifs",
          value:  master.activeSpeakers.length > 0
            ? master.activeSpeakers.map((id) => `<@${id}>`).join(", ")
            : "_Aucun_",
          inline: true,
        },
        {
          name:   "🔄 Reconnexions source",
          value:  String(master.reconnectAttempts ?? 0),
          inline: true,
        }
      );

    // ── Relay bots ────────────────────────────────────────────────────

    if (relayBots.length > 0) {
      const lines = relayBots.map((bot) => {
        const s = bot.getStatus();

        // Icône état
        let icon;
        if (s.connected && s.registered)       icon = "🟢"; // en ligne et actif
        else if (s.broadcasting && !s.connected) icon = "🟡"; // reconnexion en cours
        else                                     icon = "🔴"; // arrêté

        const parts = [`${icon} **${s.name}** — <#${s.channelId}>`];

        if (!s.connected && s.broadcasting) {
          parts.push(`_(reconnexion… tentative ${s.reconnectAttempts})_`);
        }
        if (s.reconnectAttempts >= 3 && s.broadcasting) {
          parts.push(`⚠️ _${s.reconnectAttempts} tentatives échouées_`);
        }
        if (s.queueDepth > 0) {
          parts.push(`_buf: ${s.queueDepth}_`);
        }

        return parts.join(" ");
      });

      // Résumé
      const online  = relayBots.filter((b) => b.getStatus().connected).length;
      const recon   = relayBots.filter((b) => { const s = b.getStatus(); return s.broadcasting && !s.connected; }).length;
      const offline = relayBots.length - online - recon;

      let summary = `🟢 ${online} en ligne`;
      if (recon   > 0) summary += ` · 🟡 ${recon} reconnexion`;
      if (offline > 0) summary += ` · 🔴 ${offline} hors ligne`;

      embed.addFields({
        name:  `📢 Relay Bots — ${summary}`,
        value: lines.join("\n"),
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logger.info("Status affiché", { user: interaction.user.tag });
  },
};
