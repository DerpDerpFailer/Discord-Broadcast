"use strict";

/**
 * config-store.js
 *
 * Lecture/écriture de la configuration persistante en JSON.
 * Ce fichier est écrit par /setup et lu au démarrage dans config.js.
 *
 * Chemin par défaut : /data/config.json (volume Docker)
 * Configurable via CONFIG_PATH.
 */

const fs   = require("fs");
const path = require("path");

const CONFIG_PATH = process.env.CONFIG_PATH || "/data/config.json";

/**
 * Charge la config JSON sauvegardée.
 * Retourne {} si le fichier n'existe pas ou est invalide.
 * @returns {object}
 */
function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch (e) {
    console.warn(`[config-store] Impossible de lire ${CONFIG_PATH} :`, e.message);
  }
  return {};
}

/**
 * Sauvegarde la config JSON.
 * @param {object} data
 */
function save(data) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

module.exports = { load, save, CONFIG_PATH };
