"use strict";

const { SlashCommandBuilder } = require("discord.js");
const logger = require("../utils/logger").child("cmd:stop");
const i18n   = require("../i18n");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête le broadcast vocal")
    .setDescriptionLocalizations({ "en-US": "Stop the voice broadcast", "en-GB": "Stop the voice broadcast" }),

  async execute(interaction, masterBot) {
    const { t } = i18n(interaction.locale);

    if (!masterBot.isBroadcasting) {
      return interaction.reply({ content: t("stop.notRunning"), ephemeral: true });
    }

    await interaction.deferReply();
    logger.info("Commande stop reçue", { user: interaction.user.tag });

    try {
      await Promise.allSettled(masterBot._relayBots.map((bot) => bot.stopBroadcast()));
      await masterBot.stopBroadcast();
      await interaction.editReply({ content: t("stop.success") });
    } catch (err) {
      logger.error("Erreur stop", { error: err.message });
      await interaction.editReply({ content: t("stop.error", { error: err.message }) });
    }
  },
};
