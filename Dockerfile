# ── Build stage ──────────────────────────────────────────────────────────────
# Pinned to the exact Node version that ran on the arm64 VM (Node 22 upgrade: later)
FROM node:20.20.2-bookworm-slim AS builder

WORKDIR /app

# Build tools needed to compile native addons:
#   - sodium-native  → nécessite libsodium-dev pour compiler les bindings C
#   - @discordjs/opus → nécessite build-essential pour les bindings Opus
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    libsodium-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first (layer cache optimisation)
COPY package.json package-lock.json ./

# Reproducible install from the lockfile (versions identical to the VM build)
RUN npm ci --include=optional --no-audit --no-fund

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20.20.2-bookworm-slim

WORKDIR /app

# Runtime libs needed by native addons and audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsodium23 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY package.json          ./package.json
COPY src/                  ./src/
COPY scripts/              ./scripts/
COPY docker-entrypoint.sh  ./docker-entrypoint.sh

# Run as non-root user, fixed UID/GID 999 (same as the historical implicit value,
# so existing /data volumes keep their ownership)
RUN groupadd -r -g 999 discord && useradd -r -u 999 -g discord discord

# Créer /data et donner les droits à l'utilisateur discord
RUN mkdir -p /data && chown discord:discord /data

# Rendre l'entrypoint exécutable (avant de switcher d'utilisateur)
RUN chmod +x docker-entrypoint.sh

USER discord

# Health check : vérifie que les bots sont réellement connectés à Discord
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD node scripts/healthcheck.js || exit 1

CMD ["./docker-entrypoint.sh"]
