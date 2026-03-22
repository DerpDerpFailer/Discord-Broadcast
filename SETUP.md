# 🛠️ Guide d'installation — Discord Broadcast System

Ce guide couvre l'installation complète du système depuis zéro, que ce soit pour une première installation ou une réinstallation sur une nouvelle VM.

---

## Prérequis

### Serveur
- VM Linux (Ubuntu 20.04+ recommandé), minimum 1 vCPU / 512 MB RAM
- Docker + Docker Compose installés
- Portainer installé et accessible
- Accès SSH ou console

### Compte Discord
- Accès à https://discord.com/developers/applications
- Droits Administrateur sur le serveur Discord cible
- Mode Développeur activé dans Discord (Paramètres → Avancés → Mode développeur)

---

## Étape 1 — Créer les bots Discord

Sur https://discord.com/developers/applications, créer **N+1 applications** : 1 master bot + 1 relay bot par canal cible.

Pour **chaque bot** :

1. **New Application** → donner un nom → **Create**
2. Onglet **Bot** → **Add Bot** → **Reset Token** → copier et sauvegarder le token
3. Onglet **Bot** → **Privileged Gateway Intents** → activer **Server Members Intent** et **Voice State Intent** → **Save Changes**
4. Onglet **OAuth2** → **URL Generator**
   - Scopes : cocher `bot` et `applications.commands`
   - Bot Permissions : cocher `Connect`, `Speak`, `Use Voice Activity`
   - Pour le **Master Bot uniquement** : ajouter aussi `View Channels` et `Send Messages`
5. Copier l'URL générée → l'ouvrir dans le navigateur → inviter le bot sur le serveur Discord

> Répéter pour chaque relay bot. Chaque bot doit être invité individuellement.

---

## Étape 2 — Récupérer les IDs Discord

Dans Discord (Mode Développeur activé) :

| Élément | Comment l'obtenir |
|---|---|
| **Guild ID** | Clic droit sur le serveur → Copier l'identifiant du serveur |
| **Source Channel ID** | Clic droit sur le canal vocal source → Copier l'identifiant |
| **Target Channel ID** (×N) | Clic droit sur chaque canal cible → Copier l'identifiant |
| **Shotcaller Role ID** | Paramètres serveur → Rôles → clic droit sur le rôle → Copier l'identifiant |
| **Staff Role ID** | Idem (optionnel) |
| **Alert Channel ID** | Clic droit sur le salon texte d'alertes → Copier l'identifiant (optionnel) |

---

## Étape 3 — Déployer via Portainer

### 3.1 Créer la stack

1. Portainer → **Stacks** → **Add stack**
2. Choisir **Repository**
3. Remplir :
   - **Name** : `discord-broadcast`
   - **Repository URL** : `https://github.com/DerpDerpFailer/Discord-Broadcast`
   - **Branch** : `main`
   - **Compose path** : `docker-compose.yml`

### 3.2 Ajouter les variables d'environnement

Dans la section **Environment variables**, ajouter toutes les variables suivantes :

#### Variables obligatoires

| Variable | Valeur |
|---|---|
| `MASTER_BOT_TOKEN` | Token du master bot |
| `GUILD_ID` | ID du serveur Discord |
| `SOURCE_CHANNEL_ID` | ID du canal source (Shotcallers) |
| `SHOTCALLER_ROLE_ID` | ID du rôle Shotcaller |

#### Variables optionnelles

| Variable | Valeur |
|---|---|
| `STAFF_ROLE_ID` | ID du rôle Staff (peut gérer le bot sans être broadcasté) |
| `ALERT_CHANNEL_ID` | ID du salon texte pour les alertes de déconnexion |

#### Relay bots (répéter pour chaque relay, N = 1 à 20)

| Variable | Valeur |
|---|---|
| `RELAY_BOT_TOKEN_N` | Token du relay bot N |
| `TARGET_CHANNEL_ID_N` | ID du canal cible du relay N |
| `RELAY_BOT_NAME_N` | Nom affiché (ex: `Team 1`) |

> ⚠️ Les paires `RELAY_BOT_TOKEN_N` / `TARGET_CHANNEL_ID_N` doivent être **consécutives** et commencer à 1. Le système s'arrête dès qu'il ne trouve plus de paire.

#### Variables audio (optionnelles, valeurs par défaut recommandées)

| Variable | Défaut | Description |
|---|---|---|
| `SILENCE_THRESHOLD_MS` | `150` | Délai silence avant arrêt speaker |
| `MAX_BUFFER_FRAMES` | `25` | Buffer max par speaker |
| `WATCHDOG_THRESHOLD_MS` | `5000` | Watchdog pipeline (0 = désactivé) |
| `AUTO_DISCONNECT_MS` | `600000` | Auto-disconnect inactivité (0 = désactivé) |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |

### 3.3 Déployer

Cliquer **Deploy the stack** et attendre que le container passe en état `running`.

Vérifier dans Portainer → Containers que `discord-broadcast` est **healthy** (après ~90s de démarrage).

---

## Étape 4 — Enregistrer les commandes slash

Cette étape est à faire **une seule fois** après le premier déploiement, et à répéter uniquement si des commandes sont ajoutées ou modifiées.

Portainer → **Containers** → `discord-broadcast` → **Console** → **Connect**

```bash
node scripts/register-commands.js
```

Résultat attendu :
```
✅ 6 commandes enregistrées :
   /start — Démarre le broadcast vocal vers tous les canaux cibles
   /stop — Arrête le broadcast vocal
   /status — Affiche le statut du système de broadcast
   /setup — Configure le système de broadcast vocal
   /mute — Mute ou démute un relay bot (panel interactif)
   /volume — Ajuste le volume d'un relay bot (panel interactif)
```

---

## Étape 5 — Configurer via /setup

Dans Discord, avec un compte **Administrateur** du serveur :

```
/setup
```

Le wizard guide à travers 5 étapes :
1. **Canal source** — le canal vocal que le master bot écoute
2. **Rôle Shotcaller** — le rôle dont la voix est broadcastée + peut utiliser /start /stop
3. **Rôle Staff** — peut utiliser /start /stop mais n'est pas broadcasté (optionnel)
4. **Salon d'alertes** — salon texte pour recevoir les alertes de déconnexion (optionnel)
5. **Canal cible** — le canal vocal de chaque relay bot, un par un

Terminer par **💾 Sauvegarder**. La configuration est persistée dans `/data/config.json` et s'applique immédiatement.

> Cette étape est optionnelle si toutes les variables d'environnement ont été correctement renseignées à l'étape 3. Mais elle permet de vérifier et ajuster la config sans redéployer.

---

## Étape 6 — Tester

```
/start       → tous les bots rejoignent leurs canaux
/status      → vérifier que tous les bots sont en 🟢
```

Parler dans le canal source → la voix doit être entendue dans tous les canaux cibles.

```
/stop        → tous les bots quittent leurs canaux
```

---

## Ajouter des relay bots après coup

1. Créer les nouveaux bots sur le Discord Developer Portal (voir Étape 1)
2. Les inviter sur le serveur Discord
3. Ajouter les variables `RELAY_BOT_TOKEN_N`, `TARGET_CHANNEL_ID_N`, `RELAY_BOT_NAME_N` dans Portainer
4. Si les lignes correspondantes sont commentées dans `docker-compose.yml`, les décommenter, pusher sur GitHub
5. Portainer → stack → **Update the stack**
6. Vérifier via `/status` que les nouveaux bots apparaissent

---

## Mise à jour du bot

### Changements JS uniquement (pas de modification Dockerfile)

Portainer → stack → **Update the stack** (pull le dernier commit de `main` et redémarre).

### Modification du Dockerfile ou des dépendances

Se connecter en SSH et rebuilder :

```bash
cd /chemin/vers/discord-broadcast
git pull
sudo docker compose build
sudo docker compose up -d
```

### Re-register les commandes

Uniquement si des commandes slash ont été ajoutées ou modifiées :

```bash
docker exec discord-broadcast node scripts/register-commands.js
```

---

## Rollback vers une version précédente

```bash
# Sur le serveur via SSH
sudo docker tag discord-broadcast:vX.Y.Z discord-broadcast:latest
sudo docker restart discord-broadcast
```

| Tag | Contenu |
|---|---|
| `v1.0.0` | Broadcast stable, sans /setup |
| `v1.1.0` | Wizard /setup + reconnexion auto |
| `v1.2.0` | Rôle Staff + /status enrichi + alertes Discord |
| `v1.3.0` | Watchdog pipeline + auto-disconnect + /setup avancé |
| `v1.4.0` | /mute et /volume par speaker (ancienne implémentation) |
| `v1.5.0` | /mute et /volume interactifs par relay bot |
| `v1.6.0` | Alertes reconnexion master bot + health check Docker |
| `v1.7.0` | Localisation FR/EN |
| `v1.8.0` | /start [nombre] + état ⚫ relay bots non démarrés + bouton refresh /status |

---

## Dépannage

### Le container ne passe pas healthy

```bash
# Voir les logs
docker logs discord-broadcast

# Vérifier la config chargée
docker exec discord-broadcast node -e "const c = require('./src/config'); console.log(JSON.stringify(c, null, 2))"

# Tester le health check manuellement
docker exec discord-broadcast node scripts/healthcheck.js
```

### Les commandes slash n'apparaissent pas dans Discord

Attendre 1-2 minutes (propagation Discord), puis vérifier que l'enregistrement s'est bien passé :

```bash
docker exec discord-broadcast node scripts/register-commands.js
```

### Les bots ne rejoignent pas les canaux vocaux

- Vérifier que les bots ont bien été invités sur le serveur avec les bonnes permissions
- Vérifier que les `TARGET_CHANNEL_ID` pointent vers des canaux **vocaux** et non texte
- Consulter les logs : `docker logs discord-broadcast`

### Les alertes Discord n'arrivent pas

- Vérifier que le Master Bot a les permissions **Voir le salon** et **Envoyer des messages** sur le salon d'alertes
- Vérifier que `ALERT_CHANNEL_ID` est bien défini

### Simuler une coupure réseau pour tester les alertes

```bash
sudo iptables -A OUTPUT -d 162.159.0.0/16 -j DROP
# Attendre ~60s → les alertes de déconnexion doivent arriver
sudo iptables -D OUTPUT -d 162.159.0.0/16 -j DROP
# Les alertes de rétablissement doivent arriver
```
