"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:volume");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Ajuste le volume d'un relay bot (0-200%)")
    .addStringOption((opt) =>
      opt.setName("relay")
        .setDescription("Nom du relay bot (vide = voir tous les volumes)")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt.setName("valeur")
        .setDescription("Volume en % (0 = silence, 100 = normal, 200 = max)")
        .setMinValue(0)
        .setMaxValue(200)
        .setRequired(false)
    ),

  async execute(interaction, masterBot) {
    await interaction.deferReply({ flags: 64 });

    const dispatcher = masterBot.dispatcher;
    const relayBots  = masterBot._relayBots;
    const query      = interaction.options.getString("relay")?.toLowerCase() ?? null;
    const value      = interaction.options.getInteger("valeur");

    // ── Sans argument : afficher tous les volumes ───────────────────────────
    if (!query) {
      const lines = relayBots.map((bot) => {
        const vol   = dispatcher.getRelayVolume(bot.relayId);
        const muted = dispatcher.isRelayMuted(bot.relayId);
        const bar   = volumeBar(vol);
        return `🎚️ **${bot.name}** — **${vol}%** ${bar}${muted ? " 🔇" : ""}`;
      });

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎚️ Volumes des relay bots")
            .setColor(0x5865f2)
            .setDescription(lines.join("\n"))
            .setFooter({ text: "Utilisez /volume <nom> <valeur> pour ajuster" }),
        ],
      });
    }

    // ── Trouver le relay ────────────────────────────────────────────────────
    const bot = relayBots.find((b) => b.name.toLowerCase().includes(query));
    if (!bot) {
      const names = relayBots.map((b) => `\`${b.name}\``).join(", ");
      return interaction.editReply(`❌ Relay introuvable. Relays disponibles : ${names}`);
    }

    // ── Sans valeur : afficher le volume actuel ─────────────────────────────
    if (value === null) {
      const vol = dispatcher.getRelayVolume(bot.relayId);
      return interaction.editReply(
        `🎚️ **${bot.name}** — volume actuel : **${vol}%** ${volumeBar(vol)}`
      );
    }

    // ── Avec valeur : ajuster ───────────────────────────────────────────────
    if (!masterBot.isBroadcasting) {
      return interaction.editReply("⚠️ Aucun broadcast en cours.");
    }

    dispatcher.setRelayVolume(bot.relayId, value);
    logger.info("Volume relay ajusté", { relay: bot.name, value, by: interaction.user.tag });

    const emoji = value === 0 ? "🔇" : value < 50 ? "🔈" : value <= 120 ? "🔉" : "🔊";
    return interaction.editReply(
      `${emoji} **${bot.name}** — <#${bot.channelId}> réglé à **${value}%** ${volumeBar(value)}`
    );
  },
};

// ── Helper ────────────────────────────────────────────────────────────────

function volumeBar(percent) {
  const filled = Math.round(percent / 20); // 10 blocs pour 200%
  const empty  = 10 - filled;
  return `[${"█".repeat(Math.max(0, filled))}${"░".repeat(Math.max(0, empty))}]`;
}
