"use strict";

/**
 * i18n/index.js
 *
 * Système de localisation minimal.
 * Langues supportées : fr (défaut), en
 *
 * Usage :
 *   const { t, locale } = require('../i18n')(interaction.locale);
 *   t('start.alreadyRunning')
 *   t('start.success', { source: '#shotcallers', count: 8, total: 8 })
 */

const fr = require("./fr");
const en = require("./en");

const SUPPORTED = { fr, en };
const DEFAULT   = "en";

// Locales Discord → code i18n
const LOCALE_MAP = {
  "fr":    "fr",
  "en-US": "en",
  "en-GB": "en",
};

/**
 * Résout une clé dotted dans un objet imbriqué.
 * ex: get({ start: { success: "OK" } }, "start.success") → "OK"
 */
function get(obj, key) {
  return key.split(".").reduce((o, k) => o?.[k], obj);
}

/**
 * Interpolate {{var}} placeholders in a string.
 */
function interpolate(str, vars = {}) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
}

/**
 * Retourne la fonction t() et la locale résolue pour une interaction.
 * @param {string} discordLocale - interaction.locale ou interaction.guildLocale
 */
function i18n(discordLocale) {
  const lang    = LOCALE_MAP[discordLocale] ?? DEFAULT;
  const strings = SUPPORTED[lang] ?? SUPPORTED[DEFAULT];
  const fallback = SUPPORTED[DEFAULT];

  function t(key, vars = {}) {
    const val = get(strings, key) ?? get(fallback, key) ?? key;
    return interpolate(val, vars);
  }

  return { t, lang };
}

module.exports = i18n;
