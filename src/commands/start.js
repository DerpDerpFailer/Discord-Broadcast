"use strict";

const { SlashCommandBuilder } = require("discord.js");
const config = require("../config");
const logger = require("../utils/logger").child("cmd:start");
const i18n   = require("../i18n");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Démarre le broadcast vocal vers tous les canaux cibles")
    .setDescriptionLocalizations({ "en-US": "Start the voice broadcast to all target channels", "en-GB": "Start the voice broadcast to all target channels" })
    .addIntegerOption((opt) =>
      opt
        .setName("nombre")
        .setNameLocalizations({ "en-US": "count", "en-GB": "count" })
        .setDescription("Nombre de relay bots à démarrer (défaut : tous)")
        .setDescriptionLocalizations({ "en-US": "Number of relay bots to start (default: all)", "en-GB": "Number of relay bots to start (default: all)" })
        .setMinValue(1)
        .setRequired(false)
    ),

  async execute(interaction, masterBot) {
    const { t } = i18n(interaction.locale);

    if (masterBot.isBroadcasting) {
      return interaction.reply({ content: t("start.alreadyRunning"), ephemeral: true });
    }

    // Paramètre optionnel — null si non fourni
    const nombre = interaction.options.getInteger("nombre") ?? interaction.options.getInteger("count");
    const total  = masterBot._relayBots.length;
    const count  = nombre ? Math.min(nombre, total) : total;
    const bots   = masterBot._relayBots.slice(0, count);

    // Marquer les bots non démarrés comme volontairement désactivés
    masterBot._relayBots.forEach((bot, i) => { bot._disabled = i >= count; });

    await interaction.deferReply();
    logger.info("Commande start reçue", { user: interaction.user.tag, bots: count, total });

    // ── Vérification des permissions (pré-vol) ────────────────────────────
    const [masterMissing, ...relayChecks] = await Promise.all([
      masterBot.checkPermissions(),
      ...bots.map(async (bot) => ({
        bot,
        missing: await bot.checkPermissions(),
      })),
    ]);

    const permIssues = relayChecks.filter((c) => c.missing.length > 0);
    if (masterMissing.length > 0 || permIssues.length > 0) {
      const lines = [];
      if (masterMissing.length > 0)
        lines.push(t("start.permWarning", { name: "Master Bot (canal source)", perms: masterMissing.join(", ") }));
      permIssues.forEach((c) =>
        lines.push(t("start.permWarning", { name: c.bot.name, perms: c.missing.join(", ") }))
      );
      await interaction.followUp({
        content: t("start.permHeader") + "\n" + lines.join("\n"),
        ephemeral: true,
      });
    }

    try {
      await masterBot.startBroadcast();

      const results = await Promise.allSettled(bots.map((bot) => bot.startBroadcast()));

      const failed  = results.filter((r) => r.status === "rejected");
      const success = results.filter((r) => r.status === "fulfilled");

      let content = t("start.success", {
        source: `<#${config.sourceChannelId}>`,
        count:  success.length,
        total:  count,
      });

      if (count < total) content += t("start.partial", { count, total });
      if (failed.length > 0) content += t("start.successWarning", { failed: failed.length });
      content += "\n\n" + t("start.hint");

      await interaction.editReply({ content });
    } catch (err) {
      logger.error("Erreur start", { error: err.message });
      await interaction.editReply({ content: t("start.error", { error: err.message }) });
    }
  },
};
