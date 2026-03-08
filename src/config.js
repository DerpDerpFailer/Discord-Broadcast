"use strict";

/**
 * config.js
 *
 * Lit toutes les variables depuis process.env (injectées par Docker).
 * Valide au démarrage — plante avec un message clair si quelque chose manque.
 * Aucun fichier .env n'est requis.
 */

function parseRelayBots() {
  const bots = [];
  let i = 1;
  while (
    process.env[`RELAY_BOT_TOKEN_${i}`] &&
    process.env[`TARGET_CHANNEL_ID_${i}`]
  ) {
    bots.push({
      token:     process.env[`RELAY_BOT_TOKEN_${i}`],
      channelId: process.env[`TARGET_CHANNEL_ID_${i}`],
      name:      process.env[`RELAY_BOT_NAME_${i}`] || `Relay ${i}`,
      index:     i,
    });
    i++;
  }
  return bots;
}

function validateConfig(cfg) {
  const required = [
    "masterToken",
    "guildId",
    "sourceChannelId",
    "shotcallerRoleId",
  ];
  const missing = required.filter((k) => !cfg[k]);
  if (missing.length > 0) {
    throw new Error(
      `Variables d'environnement manquantes : ${missing.join(", ")}`
    );
  }
  if (cfg.relayBots.length === 0) {
    throw new Error(
      "Aucun bot relais configuré. Définissez RELAY_BOT_TOKEN_1 et TARGET_CHANNEL_ID_1 au minimum."
    );
  }
  if (cfg.relayBots.length > 20) {
    throw new Error("Maximum 20 bots relais supportés.");
  }
}

const config = {
  // Bot maître
  masterToken: process.env.MASTER_BOT_TOKEN,

  // Serveur Discord
  guildId:          process.env.GUILD_ID,
  sourceChannelId:  process.env.SOURCE_CHANNEL_ID,
  shotcallerRoleId: process.env.SHOTCALLER_ROLE_ID,
  staffRoleId:      process.env.STAFF_ROLE_ID      || null,
  alertChannelId:   process.env.ALERT_CHANNEL_ID   || null,

  // Bots relais (parsés automatiquement depuis RELAY_BOT_TOKEN_1..N)
  relayBots: parseRelayBots(),

  // Audio
  pcmFrameSize:      parseInt(process.env.PCM_FRAME_SIZE      || "3840"),
  frameDurationMs:   parseInt(process.env.FRAME_DURATION_MS   || "20"),
  jitterBufferFrames:parseInt(process.env.JITTER_BUFFER_FRAMES|| "2"),
  maxBufferFrames:   parseInt(process.env.MAX_BUFFER_FRAMES   || "25"),
  silenceThresholdMs:parseInt(process.env.SILENCE_THRESHOLD_MS|| "150"),

  // Logs
  logLevel: process.env.LOG_LEVEL || "info",
};

// Validation au chargement (fail fast)
try {
  validateConfig(config);
} catch (err) {
  console.error(`[CONFIG] ERREUR : ${err.message}`);
  process.exit(1);
}

// Surcharge avec la config JSON sauvegardée via /setup (si elle existe)
try {
  const store = require("./config-store");
  const saved = store.load();

  if (saved.sourceChannelId)  config.sourceChannelId  = saved.sourceChannelId;
  if (saved.shotcallerRoleId) config.shotcallerRoleId = saved.shotcallerRoleId;
  if (saved.staffRoleId)      config.staffRoleId      = saved.staffRoleId;
  if (saved.alertChannelId)   config.alertChannelId   = saved.alertChannelId;

  if (Array.isArray(saved.relayBots)) {
    saved.relayBots.forEach((b, i) => {
      if (config.relayBots[i]) {
        if (b.channelId) config.relayBots[i].channelId = b.channelId;
        if (b.name)      config.relayBots[i].name      = b.name;
      }
    });
  }
} catch (e) {
  // Pas de config JSON sauvegardée — on utilise les env vars uniquement
}

module.exports = config;
