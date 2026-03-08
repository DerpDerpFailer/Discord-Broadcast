# 📡 Discord Broadcast System

Système de broadcast vocal Discord en temps réel : **1 canal source → jusqu'à 20 canaux cibles**.

```
              🎙️ Shotcallers
                    │
                    ▼
            🎧 Master Bot
         (capture + dispatch)
                    │
       ┌────────────┼────────────┬────────────┐
       ▼            ▼            ▼            ▼
  📢 Bot 1     📢 Bot 2     📢 Bot 3  ...  📢 Bot N
   Team 1       Team 2       Team 3        Team N
```

## Architecture

```
src/
├── index.js              ← Point d'entrée, câble tout
├── config.js             ← Lit les variables d'environnement + overlay JSON
├── config-store.js       ← Lecture/écriture de /data/config.json
├── dispatcher.js         ← Tick unique 20ms, mixage + dispatch audio
├── master-bot.js         ← Capture audio Opus→PCM + gestion commandes
├── relay-bot.js          ← Lecture audio dans canal cible
├── voice/
│   ├── audio-stream.js   ← ContinuousPCMStream (stream passif, pas de timer)
│   └── mixer.js          ← Mixage PCM multi-speakers avec clamping int16
├── commands/
│   ├── start.js          ← /start
│   ├── stop.js           ← /stop
│   ├── status.js         ← /status
│   └── setup.js          ← /setup (wizard de configuration interactif)
└── utils/
    └── logger.js         ← Winston structuré
```

### Principes clés

- **Un seul processus Node.js** — tous les bots tournent ensemble, zéro IPC, zéro latence inter-bots
- **Un seul timer** — le dispatcher cadence tout à 20ms, les streams sont passifs (pas de double timer)
- **Pipeline audio** — Discord Opus → prism.opus.Decoder → PCM s16le 48kHz stéréo → Dispatcher → Relay bots
- **group voice unique** — chaque bot joinVoiceChannel avec son propre `group` pour éviter les collisions dans le même serveur
- **@snazzah/davey** — requis pour la compatibilité avec le nouveau chiffrement Discord voice (aead_xchacha20_poly1305_rtpsize)
- **Config persistante** — `/setup` sauvegarde la config dans `/data/config.json` (volume Docker), qui surcharge les variables d'environnement

## Prérequis

### Bots Discord à créer

Créer **N+1 applications** sur https://discord.com/developers/applications :

| Bot | Rôle |
|-----|------|
| Master Bot | Rejoint Shotcallers, écoute l'audio, gère /start /stop /status /setup |
| Relay Bot 1 | Rejoint Team 1 et joue l'audio |
| Relay Bot 2 | Rejoint Team 2 et joue l'audio |
| … | … jusqu'à 20 |

Pour chaque bot :
1. New Application → Bot → Add Bot → Reset Token → copier le token
2. Activer l'intent `GUILD_VOICE_STATES` (onglet Bot → Privileged Gateway Intents)
3. OAuth2 → URL Generator → Scopes : `bot` + `applications.commands`
4. Permissions : `Connect`, `Speak`, `Use Voice Activity`
5. Pour le Master Bot uniquement : ajouter `View Channels`

### Récupérer les IDs

Activer le Mode Développeur (Paramètres Discord → Avancés) :
- **Guild ID** : clic droit sur le serveur → Copier l'identifiant
- **Channel ID** : clic droit sur le canal vocal → Copier l'identifiant
- **Role ID** : Paramètres serveur → Rôles → clic droit → Copier l'identifiant

## Déploiement Portainer

### 1. Créer la Stack

Portainer → **Stacks** → **Add stack** → **Repository**
- URL : `https://github.com/TON-USERNAME/discord-broadcast`
- Branch : `main`
- Compose path : `docker-compose.yml`

### 2. Ajouter les variables d'environnement

Dans la section **Environment variables** :

| Variable | Description |
|---|---|
| `MASTER_BOT_TOKEN` | Token du bot maître |
| `GUILD_ID` | ID du serveur Discord |
| `SOURCE_CHANNEL_ID` | ID du canal Shotcallers (remplaçable via /setup) |
| `SHOTCALLER_ROLE_ID` | ID du rôle autorisé (remplaçable via /setup) |
| `RELAY_BOT_TOKEN_1` | Token relay bot 1 |
| `TARGET_CHANNEL_ID_1` | ID canal Team 1 (remplaçable via /setup) |
| `RELAY_BOT_NAME_1` | `Team 1` (remplaçable via /setup) |
| `RELAY_BOT_TOKEN_2` | Token relay bot 2 |
| `TARGET_CHANNEL_ID_2` | ID canal Team 2 |
| … | … |

> **Note** : Les tokens des bots ne peuvent pas être modifiés via `/setup` pour des raisons de sécurité. Tous les autres paramètres sont configurables interactivement.

### 3. Deploy the stack

Cliquez **Deploy the stack**.

### 4. Enregistrer les commandes slash (une seule fois)

Portainer → Containers → `discord-broadcast` → **Console** → Connect

```bash
node scripts/register-commands.js
```

Résultat attendu :
```
✅ 4 commandes enregistrées :
   /start  — Démarre le broadcast vocal...
   /stop   — Arrête le broadcast vocal
   /status — Affiche le statut du système de broadcast
   /setup  — Configure le système de broadcast vocal
```

## Utilisation

Dans Discord (avec le rôle Shotcaller) :

| Commande | Effet |
|---|---|
| `/start` | Tous les bots rejoignent leurs canaux, broadcast actif |
| `/stop` | Tous les bots quittent leurs canaux |
| `/status` | Affiche l'état, les speakers actifs, les stats |
| `/setup` | Lance le wizard de configuration interactif |

### Wizard /setup

Le wizard guide étape par étape :

```
Étape 0 → Accueil
Étape 1 → Sélection du canal source (menu déroulant des canaux vocaux)
Étape 2 → Sélection du rôle autorisé
Étape 3 → Configuration de chaque relay bot (canal cible + nom)
Étape 4 → Récapitulatif + Sauvegarder
```

La configuration est sauvegardée dans `/data/config.json` (volume Docker persistant) et s'applique **immédiatement** sans redémarrage. Relancez simplement `/start` pour utiliser les nouveaux canaux.

## Variables d'environnement complètes

| Variable | Défaut | Description |
|---|---|---|
| `MASTER_BOT_TOKEN` | — | **Requis** |
| `GUILD_ID` | — | **Requis** |
| `SOURCE_CHANNEL_ID` | — | **Requis** (surchargeble via /setup) |
| `SHOTCALLER_ROLE_ID` | — | **Requis** (surchargeble via /setup) |
| `RELAY_BOT_TOKEN_N` | — | **Requis** (N = 1 à 20) |
| `TARGET_CHANNEL_ID_N` | — | **Requis** (N = 1 à 20, surchargeble via /setup) |
| `RELAY_BOT_NAME_N` | `Relay N` | Optionnel (surchargeble via /setup) |
| `FRAME_DURATION_MS` | `20` | Ne pas modifier |
| `PCM_FRAME_SIZE` | `3840` | Ne pas modifier |
| `JITTER_BUFFER_FRAMES` | `2` | Non utilisé (architecture passive) |
| `MAX_BUFFER_FRAMES` | `25` | Taille max queue par speaker |
| `SILENCE_THRESHOLD_MS` | `1000` | Délai silence avant arrêt du pipeline |
| `LOG_LEVEL` | `info` | `error/warn/info/debug` |
| `CONFIG_PATH` | `/data/config.json` | Chemin du fichier de config persistante |

## Priorité de configuration

```
/data/config.json  (via /setup)   ← priorité haute
       +
Variables d'environnement         ← fallback
```

Les variables d'environnement sont toujours requises au démarrage. `/setup` les surcharge ensuite sans redémarrage.

## Notes de déploiement importantes

### Réseau
- `network_mode: host` est requis dans `docker-compose.yml` — ne pas utiliser le bridge Docker
- Aucune redirection de port nécessaire — toutes les connexions sont sortantes vers Discord
- Pas besoin de DMZ

### Connexion voice
Les bots peuvent mettre jusqu'à 60 secondes pour établir la connexion voice (normal sur certains réseaux). Le système attend automatiquement l'événement `Ready` sans timeout bloquant.

### Chiffrement Discord
Discord impose depuis 2025 le mode `aead_xchacha20_poly1305_rtpsize`. Le package `@snazzah/davey` est requis pour la compatibilité — il est inclus dans `package.json`.

### Rollback
```bash
# Revenir à la version stable taguée
git checkout v1.0.0

# Revenir à l'image Docker stable
sudo docker tag discord-broadcast:v1.0.0 discord-broadcast:latest
sudo docker restart discord-broadcast
```

## Tests

```bash
# Tests unitaires (sans Discord)
docker exec discord-broadcast npm test

# Benchmark latence interne
docker exec discord-broadcast node tests/bench-latency.js
```

## Latence

| Composant | Latence |
|---|---|
| Dispatch interne | < 1 ms |
| Encode Opus | ~2 ms |
| Réseau Discord | 50–150 ms |
| **Total** | **~75–200 ms ✅** |

## Licence

MIT
