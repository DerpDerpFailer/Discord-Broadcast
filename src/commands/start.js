"use strict";

const { SlashCommandBuilder } = require("discord.js");
const config = require("../config");
const logger = require("../utils/logger").child("cmd:start");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Démarre le broadcast vocal vers tous les canaux cibles"),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {import('../master-bot')} masterBot
   */
  async execute(interaction, masterBot) {
    if (masterBot.isBroadcasting) {
      return interaction.reply({
        content: "⚠️ Broadcast déjà en cours. Utilisez `/stop` d'abord.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    logger.info("Commande start reçue", { user: interaction.user.tag });

    try {
      // 1. Démarrer le master (rejoint la source + lance le dispatcher)
      await masterBot.startBroadcast();

      // 2. Démarrer tous les relay bots en parallèle
      const results = await Promise.allSettled(
        masterBot._relayBots.map((bot) => bot.startBroadcast())
      );

      const failed  = results.filter((r) => r.status === "rejected");
      const success = results.filter((r) => r.status === "fulfilled");

      const lines = [
        "✅ **Broadcast démarré !**",
        "",
        `🎧 Source : <#${config.sourceChannelId}>`,
        `📢 Relays connectés : **${success.length}/${masterBot._relayBots.length}**`,
      ];

      if (failed.length > 0) {
        lines.push(`⚠️ ${failed.length} relay(s) en erreur — vérifiez les logs`);
      }

      lines.push("", "_Parlez dans le canal source pour être entendu partout._");

      await interaction.editReply({ content: lines.join("\n") });
    } catch (err) {
      logger.error("Erreur start", { error: err.message });
      await interaction.editReply({ content: `❌ Échec du démarrage : ${err.message}` });
    }
  },
};
