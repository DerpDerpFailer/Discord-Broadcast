"use strict";

const { SlashCommandBuilder } = require("discord.js");
const config = require("../config");
const logger = require("../utils/logger").child("cmd:restart");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Redémarre le broadcast (stop + start enchaînés)"),

  async execute(interaction, masterBot) {
    await interaction.deferReply();
    logger.info("Commande restart reçue", { user: interaction.user.tag });

    // ── 1. Stop ────────────────────────────────────────────────────────────
    if (masterBot.isBroadcasting) {
      await interaction.editReply("🔄 **Redémarrage…** Arrêt en cours...");
      try {
        await Promise.allSettled(masterBot._relayBots.map((b) => b.stopBroadcast()));
        await masterBot.stopBroadcast();
      } catch (err) {
        logger.error("Erreur stop durant restart", { error: err.message });
        return interaction.editReply(`❌ Échec à l'arrêt : ${err.message}`);
      }
    } else {
      await interaction.editReply("🔄 **Redémarrage…** (aucun broadcast actif, démarrage direct)");
    }

    // Petite pause pour laisser Discord libérer les slots voice
    await new Promise((r) => setTimeout(r, 1500));

    // ── 2. Start ───────────────────────────────────────────────────────────
    await interaction.editReply("🔄 **Redémarrage…** Connexion en cours...");

    try {
      await masterBot.startBroadcast();

      const results = await Promise.allSettled(
        masterBot._relayBots.map((b) => b.startBroadcast())
      );

      const failed  = results.filter((r) => r.status === "rejected");
      const success = results.filter((r) => r.status === "fulfilled");

      const lines = [
        "✅ **Broadcast redémarré !**",
        "",
        `🎧 Source : <#${config.sourceChannelId}>`,
        `📢 Relays connectés : **${success.length}/${masterBot._relayBots.length}**`,
      ];

      if (failed.length > 0) {
        lines.push(`⚠️ ${failed.length} relay(s) en erreur — vérifiez les logs`);
      }

      await interaction.editReply({ content: lines.join("\n") });
      logger.info("Restart terminé", { success: success.length, failed: failed.length });
    } catch (err) {
      logger.error("Erreur start durant restart", { error: err.message });
      await interaction.editReply(`❌ Arrêt OK mais échec au redémarrage : ${err.message}`);
    }
  },
};
