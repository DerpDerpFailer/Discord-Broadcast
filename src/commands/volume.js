"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:volume");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Ajuste le volume d'un speaker (0-200%)")
    .addUserOption((opt) =>
      opt.setName("utilisateur")
        .setDescription("Le speaker à ajuster (vide = voir tous les volumes)")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt.setName("valeur")
        .setDescription("Volume en % (0 = silence, 100 = normal, 200 = max)")
        .setMinValue(0)
        .setMaxValue(200)
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
    const value      = interaction.options.getInteger("valeur");

    // ── Sans argument : afficher tous les volumes ───────────────────────────
    if (!target) {
      const activeSpeakers = masterBot.getStatus().activeSpeakers;

      if (activeSpeakers.length === 0) {
        return interaction.editReply("🎤 Aucun speaker actif en ce moment.");
      }

      const lines = activeSpeakers.map((userId) => {
        const vol   = dispatcher.getVolume(userId);
        const bar   = volumeBar(vol);
        return `🎚️ <@${userId}> — **${vol}%** ${bar}`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🎚️ Volumes des speakers")
        .setColor(0x5865f2)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Utilisez /volume @user <valeur> pour ajuster" });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── Avec utilisateur mais sans valeur : afficher son volume ─────────────
    if (value === null) {
      const vol = dispatcher.getVolume(target.id);
      return interaction.editReply(
        `🎚️ **${target.displayName}** : volume actuel à **${vol}%** ${volumeBar(vol)}`
      );
    }

    // ── Avec utilisateur et valeur : ajuster ────────────────────────────────
    if (!masterBot.isBroadcasting) {
      return interaction.editReply("⚠️ Aucun broadcast en cours.");
    }

    dispatcher.setVolume(target.id, value);
    logger.info("Volume ajusté", { target: target.tag, value, by: interaction.user.tag });

    const emoji = value === 0 ? "🔇" : value < 50 ? "🔈" : value <= 120 ? "🔉" : "🔊";
    return interaction.editReply(
      `${emoji} **${target.displayName}** : volume réglé à **${value}%** ${volumeBar(value)}`
    );
  },
};

// ── Helper ────────────────────────────────────────────────────────────────

function volumeBar(percent) {
  const filled = Math.round(percent / 20); // 10 blocs pour 200%
  const empty  = 10 - filled;
  return `[${"█".repeat(Math.max(0, filled))}${"░".repeat(Math.max(0, empty))}]`;
}
