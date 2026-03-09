"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:mute");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute ou démute un relay bot (la team n'entend plus le broadcast)")
    .addStringOption((opt) =>
      opt.setName("relay")
        .setDescription("Nom du relay bot à muter/démuter (vide = voir l'état actuel)")
        .setRequired(false)
    ),

  async execute(interaction, masterBot) {
    await interaction.deferReply({ flags: 64 });

    const dispatcher = masterBot.dispatcher;
    const relayBots  = masterBot._relayBots;
    const query      = interaction.options.getString("relay")?.toLowerCase() ?? null;

    // ── Sans argument : afficher l'état de tous les relays ──────────────────
    if (!query) {
      const lines = relayBots.map((bot) => {
        const muted = dispatcher.isRelayMuted(bot.relayId);
        const status = bot.getStatus();
        return `${muted ? "🔇" : "🔊"} **${bot.name}** — <#${bot.channelId}> ${muted ? "_(muté)_" : ""}${!status.connected ? " ⚠️" : ""}`;
      });

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🔊 État des relay bots")
            .setColor(0x5865f2)
            .setDescription(lines.join("\n"))
            .setFooter({ text: "Utilisez /mute <nom> pour muter/démuter un relay" }),
        ],
      });
    }

    // ── Avec argument : trouver le relay par nom ─────────────────────────────
    if (!masterBot.isBroadcasting) {
      return interaction.editReply("⚠️ Aucun broadcast en cours.");
    }

    const bot = relayBots.find((b) => b.name.toLowerCase().includes(query));
    if (!bot) {
      const names = relayBots.map((b) => `\`${b.name}\``).join(", ");
      return interaction.editReply(`❌ Relay introuvable. Relays disponibles : ${names}`);
    }

    const wasMuted = dispatcher.isRelayMuted(bot.relayId);
    if (wasMuted) {
      dispatcher.unmuteRelay(bot.relayId);
      logger.info("Relay démuté", { relay: bot.name, by: interaction.user.tag });
      return interaction.editReply(`🔊 **${bot.name}** — <#${bot.channelId}> entend de nouveau le broadcast.`);
    } else {
      dispatcher.muteRelay(bot.relayId);
      logger.info("Relay muté", { relay: bot.name, by: interaction.user.tag });
      return interaction.editReply(`🔇 **${bot.name}** — <#${bot.channelId}> ne reçoit plus le broadcast.`);
    }
  },
};
