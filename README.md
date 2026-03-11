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
├── master-bot.js         ← Capture audio Opus→PCM + gestion commandes + watchdog
├── relay-bot.js          ← Lecture audio dans canal cible + reconnexion auto
├── voice/
│   ├── audio-stream.js   ← ContinuousPCMStream (stream passif, pas de timer)
│   └── mixer.js          ← Mixage PCM multi-speakers avec clamping int16
├── commands/
│   ├── start.js          ← /start
│   ├── stop.js           ← /stop
│   ├── status.js         ← /status
│   ├── setup.js          ← /setup (wizard de configuration interactif)
│   ├── mute.js           ← /mute (panel boutons pour muter/démuter un relay)
│   └── volume.js         ← /volume (panel boutons + modale pour ajuster le volume d'un relay)
├── i18n/
│   ├── index.js          ← Fonction t(key, vars), détection locale, fallback EN
│   ├── fr.js             ← Strings françaises (langue par défaut)
│   └── en.js             ← Strings anglaises (en-US, en-GB)
└── utils/
    └── logger.js         ← Winston structuré
scripts/
├── register-commands.js  ← Enregistrement des slash commands (manuel, une seule fois)
└── healthcheck.js        ← Vérifie l'état réel des bots (utilisé par Docker HEALTHCHECK)
```

### Principes clés

- **Un seul processus Node.js** — tous les bots tournent ensemble, zéro IPC, zéro latence inter-bots
- **Un seul timer** — le dispatcher cadence tout à 20ms, les streams sont passifs (pas de double timer)
- **Pipeline audio** — Discord Opus → prism.opus.Decoder → PCM s16le 48kHz stéréo → Dispatcher → Relay bots
- **group voice unique** — chaque bot joinVoiceChannel avec son propre `group` pour éviter les collisions dans le même serveur
- **@snazzah/davey** — requis pour la compatibilité avec le nouveau chiffrement Discord voice (aead_xchacha20_poly1305_rtpsize)
- **Config persistante** — `/setup` sauvegarde la config dans `/data/config.json` (volume Docker), qui surcharge les variables d'environnement

---

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

> **Salon d'alertes** : le Master Bot doit avoir les permissions **Voir le salon** et **Envoyer des messages** sur le salon d'alertes configuré.

### Récupérer les IDs

Activer le Mode Développeur (Paramètres Discord → Avancés) :
- **Guild ID** : clic droit sur le serveur → Copier l'identifiant
- **Channel ID** : clic droit sur le canal vocal/texte → Copier l'identifiant
- **Role ID** : Paramètres serveur → Rôles → clic droit → Copier l'identifiant

---

## Déploiement Portainer

### 1. Créer la Stack

Portainer → **Stacks** → **Add stack** → **Repository**
- URL : `https://github.com/DerpDerpFailer/Discord-Broadcast`
- Branch : `main`
- Compose path : `docker-compose.yml`

### 2. Ajouter les variables d'environnement

Dans la section **Environment variables** :

| Variable | Description |
|---|---|
| `MASTER_BOT_TOKEN` | Token du bot maître |
| `GUILD_ID` | ID du serveur Discord |
| `SOURCE_CHANNEL_ID` | ID du canal Shotcallers (modifiable via /setup) |
| `SHOTCALLER_ROLE_ID` | ID du rôle Shotcaller (modifiable via /setup) |
| `RELAY_BOT_TOKEN_1` | Token relay bot 1 |
| `TARGET_CHANNEL_ID_1` | ID canal Team 1 (modifiable via /setup) |
| `RELAY_BOT_NAME_1` | `Team 1` (modifiable via /setup) |
| `RELAY_BOT_TOKEN_2` | Token relay bot 2 |
| `TARGET_CHANNEL_ID_2` | ID canal Team 2 |
| … | … |

> Les tokens des bots ne peuvent pas être modifiés via `/setup` pour des raisons de sécurité. Tous les autres paramètres sont configurables interactivement.

### 3. Deploy the stack

Cliquez **Deploy the stack**.

### 4. Enregistrer les commandes slash (à faire manuellement)

Les commandes Discord **persistent indéfiniment** — il suffit de les enregistrer une seule fois, ou après avoir ajouté/modifié une commande.

Portainer → Containers → `discord-broadcast` → **Console** → Connect

```bash
node scripts/register-commands.js
```

> ⚠️ Ne pas confondre avec le redéploiement normal (Pull and redeploy) — celui-ci ne nécessite **pas** de réenregistrer les commandes.

---

## Utilisation

### Permissions par rôle

| Action | Shotcaller | Staff | Administrateur |
|---|---|---|---|
| Voix broadcastée | ✅ | ❌ | ❌ |
| /start /stop /status | ✅ | ✅ | ❌ |
| /mute /volume | ✅ | ✅ | ❌ |
| /setup | ❌ | ❌ | ✅ |

> Si le rôle Shotcaller n'existe pas encore sur le serveur, le fallback est **Administrateur** pour permettre le bootstrap initial via `/setup`.

### Commandes Discord

| Commande | Effet |
|---|---|
| `/start` | Tous les bots rejoignent leurs canaux, broadcast actif |
| `/stop` | Tous les bots quittent leurs canaux |
| `/status` | Affiche l'état, les speakers actifs, les stats par relay |
| `/setup` | Lance le wizard de configuration interactif |
| `/mute` | Panel interactif pour muter/démuter un relay bot |
| `/volume` | Panel interactif pour ajuster le volume d'un relay bot |

### /mute — Mute par relay bot

Permet de couper le broadcast vers une team spécifique sans arrêter les autres.

```
/mute
→ Affiche le panel avec l'état de chaque relay (🔊 actif / 🔇 muté)
→ Boutons cliquables 1 2 3 … N pour toggler mute/unmute instantanément
```

- Le relay muté reçoit du silence (connexion voice maintenue, la team n'entend rien)
- L'état se réinitialise au prochain `/stop`

### /volume — Volume par relay bot

Permet d'ajuster le niveau audio envoyé à une team spécifique.

```
/volume
→ Affiche le panel avec le volume actuel de chaque relay [████░░░░░░]
→ Boutons cliquables 1 2 3 … N pour ouvrir la modale de saisie
→ Saisir un volume entre 0 et 200 (100 = normal, 200 = boost x2)
```

- 0 % = silence total, 100 % = volume normal, 200 % = boost x2
- L'état se réinitialise au prochain `/stop`

---

## Wizard /setup

Le wizard guide étape par étape. Un bouton **Suivant →** apparaît dès qu'une valeur est déjà configurée pour ne pas refaire les étapes inutilement :

```
Étape 0 → Accueil  (+ accès direct aux Paramètres avancés)
Étape 1 → Canal source (recherche par nom)
Étape 2 → Rôle Shotcaller
Étape 3 → Rôle Staff (optionnel)
Étape 4 → Salon d'alertes (optionnel)
Étape 5 → Canal cible de chaque relay bot (un par un)
Étape 6 → Récapitulatif + Sauvegarder  (+ accès aux Paramètres avancés)
Étape 7 → Paramètres avancés
```

### Paramètres avancés (/setup → 🔧)

Accessible depuis l'accueil et le récapitulatif :

| Paramètre | Défaut | Description |
|---|---|---|
| Silence avant arrêt speaker | `150 ms` | Délai avant de libérer un speaker silencieux |
| Buffer max par speaker | `25 frames` | 500ms de buffer — au-delà les frames sont droppées |
| Watchdog pipeline | `5000 ms` | Redémarre le pipeline si bloqué (0 = désactivé) |
| Auto-disconnect | `10 min` | Arrête le broadcast après X min d'inactivité (0 = désactivé) |
| Niveau de log | `info` | `error` / `warn` / `info` / `debug` |

La configuration est sauvegardée dans `/data/config.json` et s'applique **immédiatement** sans redémarrage.

---

## Robustesse

### Reconnexion automatique (backoff exponentiel)

Si un relay bot **ou le master bot** perd sa connexion voice, il tente de se reconnecter automatiquement :

- Délais : 2s → 4s → 8s → 16s → 30s (max)
- Après 3 tentatives échouées (~54s) : alerte envoyée dans le salon d'alertes
- À la reconnexion : alerte de rétablissement envoyée
- Le master bot applique le même mécanisme — si la source se coupe, le broadcast reprend automatiquement sans intervention

### Watchdog pipeline

Vérifie toutes les `WATCHDOG_THRESHOLD_MS` que le pipeline audio n'est pas bloqué :

- Si un speaker est actif **et** qu'aucune frame n'a été émise depuis plus de 5s → redémarrage automatique du pipeline
- N'intervient jamais si aucun speaker n'est actif (pas de faux positif lors des pauses naturelles)
- Envoie une alerte Discord avant de redémarrer

### Auto-disconnect

Si le canal source est inactif depuis `AUTO_DISCONNECT_MS` (défaut 10 min) :

- Arrêt propre de tous les relay bots puis du master
- Alerte Discord envoyée
- Relancer `/start` pour reprendre le broadcast

### Health check Docker

Le conteneur expose un état `healthy` / `unhealthy` visible dans Portainer et via `docker inspect`.

Le script `scripts/healthcheck.js` est exécuté toutes les 30s par Docker et vérifie :

- Le fichier `/tmp/health.json` existe et a été mis à jour il y a moins de 90s (sinon le process est bloqué)
- Le master bot est connecté à Discord
- Au moins un relay bot est connecté à Discord

Un broadcast arrêté volontairement (`/stop`) ne rend **pas** le conteneur unhealthy — les clients Discord restent connectés.

```bash
# Tester manuellement
docker exec discord-broadcast node scripts/healthcheck.js

# Voir le statut Docker
docker inspect discord-broadcast --format='{{.State.Health.Status}}'

# Historique des checks
docker inspect discord-broadcast --format='{{range .State.Health.Log}}{{.End}} — {{.Output}}{{end}}'
```

### Alertes Discord

Les alertes sont envoyées dans le salon configuré via `/setup` pour :

- Déconnexion d'un relay bot après 3 tentatives échouées
- Rétablissement d'un relay bot
- Déconnexion du master bot après 3 tentatives échouées
- Rétablissement du master bot
- Déclenchement du watchdog pipeline
- Auto-disconnect pour inactivité prolongée

> Si les alertes n'arrivent pas, vérifier que le Master Bot a les permissions **Voir le salon** et **Envoyer des messages** sur le salon d'alertes. Les logs indiquent la cause exacte en cas d'échec.

---

## Variables d'environnement complètes

| Variable | Défaut | Description |
|---|---|---|
| `MASTER_BOT_TOKEN` | — | **Requis** |
| `GUILD_ID` | — | **Requis** |
| `SOURCE_CHANNEL_ID` | — | **Requis** (modifiable via /setup) |
| `SHOTCALLER_ROLE_ID` | — | **Requis** (modifiable via /setup) |
| `STAFF_ROLE_ID` | — | Optionnel (modifiable via /setup) |
| `ALERT_CHANNEL_ID` | — | Optionnel (modifiable via /setup) |
| `RELAY_BOT_TOKEN_N` | — | **Requis** (N = 1 à 20) |
| `TARGET_CHANNEL_ID_N` | — | **Requis** (N = 1 à 20, modifiable via /setup) |
| `RELAY_BOT_NAME_N` | `Relay N` | Optionnel (modifiable via /setup) |
| `FRAME_DURATION_MS` | `20` | Ne pas modifier |
| `PCM_FRAME_SIZE` | `3840` | Ne pas modifier |
| `JITTER_BUFFER_FRAMES` | `2` | Non utilisé (architecture passive) |
| `MAX_BUFFER_FRAMES` | `25` | Buffer max par speaker (modifiable via /setup) |
| `SILENCE_THRESHOLD_MS` | `150` | Délai silence avant arrêt speaker (modifiable via /setup) |
| `WATCHDOG_THRESHOLD_MS` | `5000` | Watchdog pipeline, 0 = désactivé (modifiable via /setup) |
| `AUTO_DISCONNECT_MS` | `600000` | Auto-disconnect, 0 = désactivé (modifiable via /setup) |
| `LOG_LEVEL` | `info` | `error/warn/info/debug` (modifiable via /setup) |
| `CONFIG_PATH` | `/data/config.json` | Chemin du fichier de config persistante |

## Priorité de configuration

```
/data/config.json  (via /setup)   ← priorité haute
       +
Variables d'environnement         ← fallback au démarrage
```

Les variables d'environnement sont toujours requises au démarrage. `/setup` les surcharge ensuite sans redémarrage.

---

## Notes de déploiement

### Réseau
- `network_mode: host` est requis dans `docker-compose.yml` — ne pas utiliser le bridge Docker
- Aucune redirection de port nécessaire — toutes les connexions sont sortantes vers Discord

### Connexion voice
Les bots peuvent mettre jusqu'à 60 secondes pour établir la connexion voice (normal sur certains réseaux). Le système attend automatiquement l'événement `Ready` sans timeout bloquant.

### Chiffrement Discord
Discord impose depuis 2025 le mode `aead_xchacha20_poly1305_rtpsize`. Le package `@snazzah/davey` est requis pour la compatibilité — il est inclus dans `package.json`.

### Rebuild de l'image Docker

Nécessaire uniquement si le `Dockerfile` est modifié. Pour les changements JS, le redéploiement Portainer suffit.

```bash
# Sur le serveur via SSH
cd /chemin/vers/discord-broadcast
git pull
sudo docker compose build
sudo docker compose up -d
```

> Le bouton **"Re-pull image and redeploy"** de Portainer échoue car l'image n'est pas publiée sur un registry — c'est normal. Utiliser **"Update the stack"** ou rebuilder manuellement via SSH.

### Rollback
```bash
# Revenir à une version taguée
git checkout vX.Y.Z

# Revenir à l'image Docker stable
sudo docker tag discord-broadcast:vX.Y.Z discord-broadcast:latest
sudo docker restart discord-broadcast
```

### Versions taguées

| Tag | Contenu |
|---|---|
| `v1.0.0` | Broadcast stable, sans /setup |
| `v1.1.0` | Wizard /setup + reconnexion auto |
| `v1.2.0` | Rôle Staff + /status enrichi + alertes Discord |
| `v1.3.0` | Watchdog pipeline + auto-disconnect + /setup avancé |
| `v1.4.0` | /mute et /volume par speaker (ancienne implémentation) |
| `v1.5.0` | /mute et /volume interactifs par relay bot (boutons + modale) |
| `v1.6.0` | Alertes reconnexion master bot + health check Docker réel |
| `v1.7.0` | Localisation FR/EN — interface et commandes bilingues |

---

## Tests

```bash
# Tests unitaires (sans Discord)
docker exec discord-broadcast npm test

# Benchmark latence interne
docker exec discord-broadcast node tests/bench-latency.js

# Vérifier la config chargée
docker exec discord-broadcast node -e "const c = require('./src/config'); console.log(JSON.stringify(c, null, 2))"

# Tester le système d'alertes (couper Discord ~60s puis rétablir)
sudo iptables -A OUTPUT -d 162.159.0.0/16 -j DROP
sudo iptables -D OUTPUT -d 162.159.0.0/16 -j DROP

# Tester le health check
docker exec discord-broadcast node scripts/healthcheck.js
docker inspect discord-broadcast --format='{{.State.Health.Status}}'
```

---

## Localisation (FR / EN)

Le bot détecte automatiquement la langue Discord de l'utilisateur et répond dans sa langue.

| Locale Discord | Langue utilisée |
|---|---|
| `fr` | Français |
| `en-US`, `en-GB` | Anglais |
| Toute autre locale | Anglais (fallback par défaut) |

Les descriptions des commandes slash dans le menu `/` sont également localisées — un utilisateur avec Discord en anglais verra les descriptions en anglais directement dans l'interface.

### Architecture

```
src/i18n/
├── index.js   ← Moteur : t(key, vars), détection locale, fallback FR
├── fr.js      ← Strings françaises
└── en.js      ← Strings anglaises
```

Chaque commande appelle `i18n(interaction.locale)` pour obtenir `t()` :

```js
const { t } = i18n(interaction.locale);
t("start.success", { source: "#shotcallers", count: 8, total: 8 })
// → "✅ **Broadcast démarré !**\n\n🎧 Source : #shotcallers\n📢 Relays connectés : **8/8**"
```

### Ajouter une langue

1. Créer `src/i18n/xx.js` en copiant `en.js` et en traduisant les valeurs
2. Ajouter la langue dans `src/i18n/index.js` :

```js
const xx = require("./xx");
const SUPPORTED = { fr, en, xx };
const LOCALE_MAP = {
  "xx":    "xx",   // code locale Discord
  // ...
};
```

---

## Latence

| Composant | Latence |
|---|---|
| Dispatch interne | < 1 ms |
| Encode Opus | ~2 ms |
| Réseau Discord | 50–150 ms |
| **Total** | **~75–200 ms ✅** |

---

## Licence

MIT
