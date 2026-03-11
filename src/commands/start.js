"use strict";

const { SlashCommandBuilder } = require("discord.js");
const config = require("../config");
const logger = require("../utils/logger").child("cmd:start");
const i18n   = require("../i18n");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Démarre le broadcast vocal vers tous les canaux cibles")
    .setDescriptionLocalizations({ "en-US": "Start the voice broadcast to all target channels", "en-GB": "Start the voice broadcast to all target channels" }),

  async execute(interaction, masterBot) {
    const { t } = i18n(interaction.locale);

    if (masterBot.isBroadcasting) {
      return interaction.reply({ content: t("start.alreadyRunning"), ephemeral: true });
    }

    await interaction.deferReply();
    logger.info("Commande start reçue", { user: interaction.user.tag });

    try {
      await masterBot.startBroadcast();

      const results = await Promise.allSettled(
        masterBot._relayBots.map((bot) => bot.startBroadcast())
      );

      const failed  = results.filter((r) => r.status === "rejected");
      const success = results.filter((r) => r.status === "fulfilled");

      let content = t("start.success", {
        source: `<#${config.sourceChannelId}>`,
        count:  success.length,
        total:  masterBot._relayBots.length,
      });

      if (failed.length > 0) content += t("start.successWarning", { failed: failed.length });
      content += "\n\n" + t("start.hint");

      await interaction.editReply({ content });
    } catch (err) {
      logger.error("Erreur start", { error: err.message });
      await interaction.editReply({ content: t("start.error", { error: err.message }) });
    }
  },
};
