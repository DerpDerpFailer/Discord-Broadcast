# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

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
COPY package.json ./

# Install all dependencies including native addons
RUN npm install --include=optional

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

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
COPY package.json     ./package.json
COPY src/             ./src/
COPY scripts/         ./scripts/

# Run as non-root user
RUN groupadd -r discord && useradd -r -g discord discord

# Créer /data et donner les droits à l'utilisateur discord
RUN mkdir -p /data && chown discord:discord /data

USER discord

# Basic liveness check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('./src/config.js'); process.exit(0)" || exit 1

CMD ["node", "src/index.js"]
