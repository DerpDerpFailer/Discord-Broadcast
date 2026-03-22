# 📡 Guide — Voice Broadcast System

The broadcast bot lets **Shotcallers** speak in real time to all team channels simultaneously.

---

## 🎭 Who can do what?

🎤 **Shotcaller**
→ Voice broadcasted ✅
→ /start /stop /status /mute /volume ✅

🛡️ **Staff**
→ Voice broadcasted ❌
→ /start /stop /status /mute /volume ✅

⚙️ **Administrator**
→ /setup ✅

> 💡 Only members with the **Shotcaller** role are heard in team channels. Staff members can manage the bot but their voice will not be broadcast.

---

## 🚀 Start the broadcast

```
/start
```

All bots join their channels and the broadcast goes live. Shotcallers can now speak in the source channel — their voice will be heard in **all team channels** at the same time.

You can also start only some teams:
```
/start 4   → starts only the first 4 teams
```

---

## 🛑 Stop the broadcast

```
/stop
```

All bots leave their channels immediately. The broadcast is cut.

---

## 📊 Check the status

```
/status
```

Shows the full system status:
- 🟢 Bot online and active
- 🟡 Bot reconnecting
- 🔴 Bot offline (error)
- ⚫ Bot not started (intentional)

The **🔄 Refresh** button updates the information in real time.

---

## 🔇 Mute a team

```
/mute
```

Shows a panel with all bots. Click a number to mute / unmute that team **without stopping the broadcast**.

- 🔊 = team active
- 🔇 = team muted (connection maintained, the team hears nothing)

---

## 🎚️ Adjust volume

```
/volume
```

Shows a panel with the audio level for each team. Click a number to open the volume input:

- `0` = complete silence
- `100` = normal volume
- `200` = ×2 boost

---

## ⚙️ Configuration

Bot configuration (channels, roles, advanced settings) is managed via `/setup` by **Administrators** only. If needed, contact a server administrator.

---

## ❓ Common issues

**Broadcast is started but I hear nothing**
→ Check that the bot is present in your voice channel (`/status`)
→ Check that the channel is not muted (`/mute`)
→ Check that the volume is not set to 0 (`/volume`)

**I'm speaking but my voice isn't being broadcast**
→ Check that you have the **Shotcaller** role
→ Make sure you're speaking in the correct source channel

**The bot disappeared from the channel**
→ It may be reconnecting (🟡 in `/status`) — wait a few seconds
→ If the issue persists, try `/stop` then `/start`
