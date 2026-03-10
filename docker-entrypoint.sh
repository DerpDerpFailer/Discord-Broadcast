#!/bin/sh
set -e

echo "[entrypoint] Démarrage du bot..."
exec node src/index.js
