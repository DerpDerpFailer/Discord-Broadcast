#!/bin/sh
set -e

echo "[entrypoint] Enregistrement des slash commands..."
node scripts/register-commands.js

echo "[entrypoint] Démarrage du bot..."
exec node src/index.js
