#!/usr/bin/env node
"use strict";

/**
 * scripts/register-commands.js
 *
 * Enregistre les slash commands Discord pour le bot maître.
 * À exécuter UNE SEULE FOIS après le déploiement, ou après modification des commandes.
 *
 * Usage :
 *   node scripts/register-commands.js
 *
 * Via Docker :
 *   docker exec discord-broadcast node scripts/register-commands.js
 *
 * Via Portainer :
 *   Containers → discord-broadcast → Console → node scripts/register-commands.js
 */

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token   = process.env.MASTER_BOT_TOKEN;
const guildId = process.env.GUILD_ID;

if (!token || !guildId) {
  console.error("ERREUR : MASTER_BOT_TOKEN et GUILD_ID doivent être définis.");
  process.exit(1);
}

const EN = { "en-US": true, "en-GB": true };
const loc = (en) => ({ "en-US": en, "en-GB": en });

const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Démarre le broadcast vocal vers tous les canaux cibles")
    .setDescriptionLocalizations(loc("Start the voice broadcast to all target channels"))
    .addIntegerOption((opt) =>
      opt
        .setName("nombre")
        .setNameLocalizations({ "en-US": "count", "en-GB": "count" })
        .setDescription("Nombre de relay bots à démarrer (défaut : tous)")
        .setDescriptionLocalizations({ "en-US": "Number of relay bots to start (default: all)", "en-GB": "Number of relay bots to start (default: all)" })
        .setMinValue(1)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête le broadcast vocal")
    .setDescriptionLocalizations(loc("Stop the voice broadcast")),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Affiche le statut du système de broadcast")
    .setDescriptionLocalizations(loc("Show the broadcast system status")),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure le système de broadcast vocal")
    .setDescriptionLocalizations(loc("Configure the broadcast system")),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute ou démute un relay bot (panel interactif)")
    .setDescriptionLocalizations(loc("Mute or unmute a relay bot (interactive panel)")),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Ajuste le volume d'un relay bot (panel interactif)")
    .setDescriptionLocalizations(loc("Adjust the volume of a relay bot (interactive panel)")),
].map((c) => c.toJSON());

(async () => {
  const rest = new REST().setToken(token);

  const app = await rest.get(Routes.currentApplication());
  console.log(`Application ID : ${app.id}`);
  console.log(`Guild ID       : ${guildId}`);
  console.log(`Enregistrement de ${commands.length} commandes...`);

  const result = await rest.put(
    Routes.applicationGuildCommands(app.id, guildId),
    { body: commands }
  );

  console.log(`\n✅ ${result.length} commandes enregistrées :`);
  result.forEach((c) => console.log(`   /${c.name} — ${c.description}`));
  console.log("\nLes commandes sont disponibles instantanément dans le serveur.");
})().catch((err) => {
  console.error("Enregistrement échoué :", err.message);
  process.exit(1);
});
