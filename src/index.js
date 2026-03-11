"use strict";

/**
 * index.js — Point d'entrée
 *
 * Séquence de démarrage :
 *   1. Charger la config (valide les env vars, plante si manquant)
 *   2. Créer AudioDispatcher
 *   3. Créer MasterBot
 *   4. Créer N RelayBots
 *   5. Login tous les bots en parallèle
 *   6. Enregistrer les slash commands (si pas déjà fait)
 *   7. Prêt — attendre /start dans Discord
 */

const fs              = require("fs");
const config          = require("./config");
const logger          = require("./utils/logger").child("Main");
const AudioDispatcher = require("./dispatcher");
const MasterBot       = require("./master-bot");
const RelayBot        = require("./relay-bot");

async function main() {
  logger.info("=== Discord Broadcast System démarrage ===");
  logger.info("Configuration chargée", {
    guildId:         config.guildId,
    sourceChannelId: config.sourceChannelId,
    relayCount:      config.relayBots.length,
    logLevel:        config.logLevel,
  });

  // 1. Dispatcher (routage audio central)
  const dispatcher = new AudioDispatcher();

  // 2. Master bot
  const masterBot = new MasterBot(dispatcher);

  // 3. Relay bots
  const relayBots = config.relayBots.map(
    ({ token, channelId, name, index }) =>
      new RelayBot({ token, channelId, guildId: config.guildId, name, index, dispatcher })
  );

  // Exposer la liste des relays au master (utilisée par les commandes)
  masterBot._relayBots = relayBots;

  // 4. Login parallèle
  logger.info(`Connexion de ${1 + relayBots.length} bots...`);

  const logins = await Promise.allSettled([
    masterBot.login(),
    ...relayBots.map((b) => b.login()),
  ]);

  logins.forEach((r, i) => {
    if (r.status === "rejected") {
      const name = i === 0 ? "MasterBot" : `RelayBot ${i}`;
      logger.error(`Login échoué : ${name}`, { error: r.reason?.message });
    }
  });

  // 4b. Câbler le callback d'alerte sur chaque relay
  relayBots.forEach((bot) => {
    bot.alertCallback = (msg) => masterBot.sendAlert(msg);
  });

  // 5. Enregistrement des slash commands
  try {
    await masterBot.registerCommands();
  } catch (err) {
    logger.warn("Enregistrement commandes échoué (non bloquant)", { error: err.message });
  }

  // 6. Résumé
  logger.info("=== Système prêt ===", {
    masterReady:  masterBot.client?.isReady() ?? false,
    relaysReady:  relayBots.filter((b) => b.client?.isReady()).length,
    totalRelays:  relayBots.length,
  });

  logger.info("Utilisez /start dans Discord pour démarrer le broadcast.");

  // ── Health check ──────────────────────────────────────────────────────────
  function writeHealth() {
    try {
      const payload = {
        timestamp:    Date.now(),
        masterReady:  masterBot.client?.isReady() ?? false,
        relaysReady:  relayBots.filter((b) => b.client?.isReady()).length,
        relaysTotal:  relayBots.length,
        broadcasting: masterBot.isBroadcasting,
      };
      fs.writeFileSync("/tmp/health.json", JSON.stringify(payload));
    } catch {}
  }

  writeHealth();
  const healthInterval = setInterval(writeHealth, 30_000);
  healthInterval.unref();

  // ── Arrêt propre ──────────────────────────────────────────────────────────

  async function shutdown(signal) {
    logger.info(`Signal ${signal} reçu — arrêt propre...`);

    try {
      if (masterBot.isBroadcasting) {
        await Promise.allSettled(relayBots.map((b) => b.stopBroadcast()));
        await masterBot.stopBroadcast();
      }
      await Promise.allSettled([
        masterBot.destroy(),
        ...relayBots.map((b) => b.destroy()),
      ]);
    } catch (err) {
      logger.error("Erreur lors de l'arrêt", { error: err.message });
    }

    logger.info("Arrêt terminé.");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.error("Exception non capturée", { error: err.message, stack: err.stack });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Promesse rejetée non gérée", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

main().catch((err) => {
  console.error("Erreur fatale au démarrage :", err);
  process.exit(1);
});
