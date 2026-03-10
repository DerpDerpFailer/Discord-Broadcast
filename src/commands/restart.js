"use strict";

const { SlashCommandBuilder } = require("discord.js");
const config = require("../config");
const logger = require("../utils/logger").child("cmd:restart");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Redémarre le broadcast (stop + start enchaînés)"),

  async execute(interaction, masterBot) {
    // Répondre immédiatement — Discord exige une réponse dans les 3s
    await interaction.reply({ content: "🔄 **Redémarrage…** Arrêt en cours...", fetchReply: true });

    const edit = (content) =>
      interaction.editReply({ content }).catch((err) =>
        logger.warn("editReply échoué", { error: err.message })
      );

    try {
      // ── 1. Stop ──────────────────────────────────────────────────────
      if (masterBot.isBroadcasting) {
        await Promise.allSettled(masterBot._relayBots.map((b) => b.stopBroadcast()));
        await masterBot.stopBroadcast();
      }

      await edit("🔄 **Redémarrage…** Connexion en cours...");

      // Pause pour laisser Discord libérer les slots voice
      await new Promise((r) => setTimeout(r, 1500));

      // ── 2. Start ─────────────────────────────────────────────────────
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

      await edit(lines.join("\n"));
      logger.info("Restart terminé", { success: success.length, failed: failed.length });

    } catch (err) {
      logger.error("Erreur restart", { error: err.message });
      await edit(`❌ Erreur durant le redémarrage : ${err.message}`);
    }
  },
};
