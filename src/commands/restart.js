"use strict";

const { SlashCommandBuilder } = require("discord.js");
const config = require("../config");
const logger = require("../utils/logger").child("cmd:restart");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Redémarre le broadcast (stop + start enchaînés)"),

  async execute(interaction, masterBot) {
    // deferReply EN PREMIER, hors de tout try/catch
    // → Discord reçoit immédiatement un "chargement..." et ne timeout jamais
    await interaction.deferReply();

    try {
      // ── 1. Stop ──────────────────────────────────────────────────────
      if (masterBot.isBroadcasting) {
        await interaction.editReply("🔄 **Redémarrage…** Arrêt en cours...");
        await Promise.allSettled(masterBot._relayBots.map((b) => b.stopBroadcast()));
        await masterBot.stopBroadcast();
      }

      // Pause pour laisser Discord libérer les slots voice
      await interaction.editReply("🔄 **Redémarrage…** Connexion en cours...");
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

      await interaction.editReply(lines.join("\n"));
      logger.info("Restart terminé", { success: success.length, failed: failed.length });

    } catch (err) {
      logger.error("Erreur restart", { error: err.message });
      await interaction.editReply(`❌ Erreur durant le redémarrage : ${err.message}`).catch(() => {});
    }
  },
};
