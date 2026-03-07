"use strict";

const { SlashCommandBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:stop");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête le broadcast vocal"),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {import('../master-bot')} masterBot
   */
  async execute(interaction, masterBot) {
    if (!masterBot.isBroadcasting) {
      return interaction.reply({
        content: "⚠️ Aucun broadcast en cours.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    logger.info("Commande stop reçue", { user: interaction.user.tag });

    try {
      // Arrêter les relays en premier
      await Promise.allSettled(
        masterBot._relayBots.map((bot) => bot.stopBroadcast())
      );

      // Puis arrêter le master
      await masterBot.stopBroadcast();

      await interaction.editReply({
        content: "🛑 **Broadcast arrêté.** Tous les bots ont quitté leurs canaux.",
      });
    } catch (err) {
      logger.error("Erreur stop", { error: err.message });
      await interaction.editReply({ content: `❌ Erreur à l'arrêt : ${err.message}` });
    }
  },
};
