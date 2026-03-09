"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:mute");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute ou démute un speaker du broadcast")
    .addUserOption((opt) =>
      opt.setName("utilisateur")
        .setDescription("Le speaker à muter/démuter (vide = voir l'état actuel)")
        .setRequired(false)
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {import('../master-bot')} masterBot
   */
  async execute(interaction, masterBot) {
    await interaction.deferReply({ ephemeral: true });

    const dispatcher = masterBot.dispatcher;
    const target     = interaction.options.getUser("utilisateur");

    // ── Sans argument : afficher l'état actuel ──────────────────────────────
    if (!target) {
      const activeSpeakers = masterBot.getStatus().activeSpeakers;

      if (activeSpeakers.length === 0) {
        return interaction.editReply("🎤 Aucun speaker actif en ce moment.");
      }

      const lines = activeSpeakers.map((userId) => {
        const muted = dispatcher.isMuted(userId);
        return `${muted ? "🔇" : "🔊"} <@${userId}> — ${muted ? "Muté" : "Actif"}`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🎤 État des speakers")
        .setColor(0x5865f2)
        .setDescription(lines.join("\n"));

      return interaction.editReply({ embeds: [embed] });
    }

    // ── Avec argument : toggle mute ─────────────────────────────────────────
    if (!masterBot.isBroadcasting) {
      return interaction.editReply("⚠️ Aucun broadcast en cours.");
    }

    const userId  = target.id;
    const wasMuted = dispatcher.isMuted(userId);

    if (wasMuted) {
      dispatcher.unmute(userId);
      logger.info("Démute", { target: target.tag, by: interaction.user.tag });
      return interaction.editReply(`🔊 **${target.displayName}** est de nouveau audible.`);
    } else {
      dispatcher.mute(userId);
      logger.info("Mute", { target: target.tag, by: interaction.user.tag });
      return interaction.editReply(`🔇 **${target.displayName}** est maintenant muté.`);
    }
  },
};
