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

const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Démarre le broadcast vocal vers tous les canaux cibles"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête le broadcast vocal"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Affiche le statut du système de broadcast"),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure le système de broadcast vocal"),
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
