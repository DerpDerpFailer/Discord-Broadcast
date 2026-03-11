#!/usr/bin/env node
"use strict";

/**
 * scripts/healthcheck.js
 *
 * Vérifie que le système est opérationnel en lisant /tmp/health.json
 * écrit par le process principal toutes les 30s.
 *
 * Codes de sortie :
 *   0 = healthy
 *   1 = unhealthy
 */

const fs   = require("fs");
const path = require("path");

const HEALTH_FILE  = "/tmp/health.json";
const MAX_AGE_MS   = 90_000; // fichier trop vieux = process bloqué

try {
  if (!fs.existsSync(HEALTH_FILE)) {
    console.error("UNHEALTHY: fichier health absent (process pas encore démarré ?)");
    process.exit(1);
  }

  const raw  = fs.readFileSync(HEALTH_FILE, "utf8");
  const data = JSON.parse(raw);
  const age  = Date.now() - data.timestamp;

  if (age > MAX_AGE_MS) {
    console.error(`UNHEALTHY: fichier health trop vieux (${Math.round(age / 1000)}s)`);
    process.exit(1);
  }

  if (!data.masterReady) {
    console.error("UNHEALTHY: master bot non connecté à Discord");
    process.exit(1);
  }

  if (data.relaysReady === 0 && data.relaysTotal > 0) {
    console.error("UNHEALTHY: aucun relay bot connecté");
    process.exit(1);
  }

  console.log(`HEALTHY: master=OK relays=${data.relaysReady}/${data.relaysTotal} uptime=${Math.round(age / 1000)}s depuis dernier ping`);
  process.exit(0);

} catch (err) {
  console.error("UNHEALTHY:", err.message);
  process.exit(1);
}
