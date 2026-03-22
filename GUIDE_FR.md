# 📡 Guide — Système de Broadcast Vocal

Le bot broadcast permet de diffuser la voix des **Shotcallers** en temps réel vers tous les canaux d'équipe simultanément.

---

## 🎭 Qui peut faire quoi ?

🎤 **Shotcaller**
→ Voix broadcastée ✅
→ /start /stop /status /mute /volume ✅

🛡️ **Staff**
→ Voix broadcastée ❌
→ /start /stop /status /mute /volume ✅

⚙️ **Administrateur**
→ /setup ✅

> 💡 Seuls les membres avec le rôle **Shotcaller** sont entendus dans les canaux d'équipe. Un Staff peut gérer le bot mais sa voix ne sera pas diffusée.

---

## 🚀 Démarrer le broadcast

```
/start
```

Tous les bots rejoignent leurs canaux et le broadcast est actif. Les Shotcallers peuvent maintenant parler dans le canal source — leur voix sera entendue dans **tous les canaux d'équipe** en même temps.

Il est aussi possible de ne démarrer qu'une partie des équipes :
```
/start 4   → démarre uniquement les 4 premières équipes
```

---

## 🛑 Arrêter le broadcast

```
/stop
```

Tous les bots quittent leurs canaux immédiatement. Le broadcast est coupé.

---

## 📊 Vérifier le statut

```
/status
```

Affiche l'état complet du système :
- 🟢 Bot en ligne et actif
- 🟡 Bot en cours de reconnexion
- 🔴 Bot hors ligne (erreur)
- ⚫ Bot non démarré (volontaire)

Le bouton **🔄 Actualiser** permet de rafraîchir les informations en temps réel.

---

## 🔇 Muter une équipe

```
/mute
```

Affiche un panel avec tous les bots. Cliquer sur un numéro pour couper / rétablir le son vers cette équipe **sans arrêter le broadcast**.

- 🔊 = équipe active
- 🔇 = équipe mutée (la connexion est maintenue, l'équipe n'entend rien)

---

## 🎚️ Ajuster le volume

```
/volume
```

Affiche un panel avec le niveau audio de chaque équipe. Cliquer sur un numéro pour ouvrir la saisie de volume :

- `0` = silence total
- `100` = volume normal
- `200` = boost ×2

---

## ⚙️ Configuration

La configuration du bot (canaux, rôles, paramètres avancés) est gérée via `/setup` par les **Administrateurs** uniquement. En cas de besoin, contacter un administrateur du serveur.

---

## ❓ Problèmes fréquents

**Le broadcast est démarré mais je n'entends rien**
→ Vérifier que le bot est bien présent dans ton canal vocal (`/status`)
→ Vérifier que le canal n'est pas muté (`/mute`)
→ Vérifier que le volume n'est pas à 0 (`/volume`)

**Je parle mais ma voix n'est pas diffusée**
→ Vérifier que tu as bien le rôle **Shotcaller**
→ Vérifier que tu parles dans le bon canal source

**Le bot a disparu du canal**
→ Il est peut-être en cours de reconnexion (🟡 dans `/status`) — attendre quelques secondes
→ Si le problème persiste, faire `/stop` puis `/start`
