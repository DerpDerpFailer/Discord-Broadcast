"use strict";

/**
 * relay-bot.js — RelayBot
 *
 * Un RelayBot par canal cible.
 * - Se connecte à Discord avec son propre token
 * - Rejoint son canal vocal cible au /start
 * - Crée un pipeline : ContinuousPCMStream → AudioResource → AudioPlayer
 * - Reçoit les frames depuis l'AudioDispatcher et les joue en temps réel
 * - S'enregistre auprès du dispatcher UNIQUEMENT quand la connexion est Ready
 */

const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  NoSubscriberBehavior,
} = require("@discordjs/voice");

const ContinuousPCMStream = require("./voice/audio-stream");
const logger = require("./utils/logger").child("RelayBot");

// Backoff exponentiel : 2s, 4s, 8s, 16s, 30s max
const RECONNECT_DELAYS = [2000, 4000, 8000, 16000, 30000];

class RelayBot {
  /**
   * @param {object} opts
   * @param {string} opts.token
   * @param {string} opts.channelId
   * @param {string} opts.guildId
   * @param {string} opts.name
   * @param {number} opts.index
   * @param {import('./dispatcher')} opts.dispatcher
   */
  constructor({ token, channelId, guildId, name, index, dispatcher }) {
    this.token      = token;
    this.channelId  = channelId;
    this.guildId    = guildId;
    this.name       = name;
    this.index      = index;
    this.relayId    = `relay-${index}`;
    this.dispatcher = dispatcher;

    this.client     = null;
    this.connection = null;
    this.player     = null;
    this.pcmStream  = null;
    this.resource   = null;

    this._broadcasting      = false;
    this._connected         = false;
    this._registered        = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer    = null;
    this._alertSent         = false;
    this._disabled          = false; // true si volontairement non démarré
    this.alertCallback      = null; // set by index.js after login
  }

  // ── Connexion Discord ─────────────────────────────────────────────────────

  async login() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });

    this.client.on("error", (err) =>
      logger.error(`Client error [${this.name}]`, { error: err.message })
    );

    await this.client.login(this.token);

    if (!this.client.isReady()) {
      await new Promise((resolve) => this.client.once("ready", resolve));
    }

    logger.info(`Relay connecté`, { name: this.name, tag: this.client.user.tag });
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────

  async startBroadcast() {
    if (this._broadcasting) {
      logger.warn(`Déjà en broadcast`, { name: this.name });
      return;
    }

    const guild   = await this.client.guilds.fetch(this.guildId);
    const channel = await guild.channels.fetch(this.channelId);

    if (!channel?.isVoiceBased()) {
      throw new Error(`[${this.name}] Canal ${this.channelId} introuvable ou pas vocal`);
    }

    logger.info(`Connexion au canal`, { name: this.name, channel: channel.name });

    this._broadcasting      = true;
    this._registered        = false;
    this._reconnectAttempts = 0;

    this._setupPlayer();
    this._setupConnection(channel);
  }

  _setupPlayer() {
    if (this.player) return;

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on("error", (err) => {
      logger.error(`Player error`, { name: this.name, error: err.message });
      if (this._broadcasting) this._restartStream();
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this._broadcasting) this._restartStream();
    });
  }

  _setupConnection(channel) {
    if (this.connection) {
      try { this.connection.destroy(); } catch {}
      this.connection = null;
    }

    this.connection = joinVoiceChannel({
      channelId:      channel.id,
      guildId:        channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf:       false,
      selfMute:       false,
      group:          this.relayId,
    });

    this.connection.subscribe(this.player);
    this._startStream();

    this.connection.on("stateChange", (oldState, newState) => {
      logger.info(`[${this.name}] ${oldState.status} -> ${newState.status}`);

      if (newState.status === VoiceConnectionStatus.Ready) {
        this._connected         = true;
        this._reconnectAttempts = 0;
        // Alerte retour en ligne si on avait alerté
        if (this._alertSent) {
          this._alertSent = false;
          this.alertCallback?.(`✅ **${this.name}** est de retour en ligne — <#${this.channelId}>`);
        }
        logger.info(`Connexion voice prête`, { name: this.name, channel: channel.name });
        if (!this._registered) {
          this._registered = true;
          this.dispatcher.registerRelay(this.relayId, this.pcmStream);
          logger.info(`Broadcast démarré`, { name: this.name, channel: channel.name });
        }
      }

      if (
        newState.status === VoiceConnectionStatus.Disconnected ||
        newState.status === VoiceConnectionStatus.Destroyed
      ) {
        if (!this._broadcasting) return;
        this._connected  = false;
        this._registered = false;
        this.dispatcher.unregisterRelay(this.relayId);
        logger.warn(`Déconnecté [${newState.status}]`, { name: this.name });
        this._scheduleReconnect(channel);
      }
    });
  }

  _scheduleReconnect(channel) {
    if (!this._broadcasting) return;
    if (this._reconnectTimer) return;

    const attempt = this._reconnectAttempts;
    const delay   = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];

    logger.info(`Reconnexion dans ${delay / 1000}s (tentative ${attempt + 1})`, { name: this.name });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer    = null;
      this._reconnectAttempts = attempt + 1;

      // Alerte après 3 tentatives échouées
      if (this._reconnectAttempts === 3 && !this._alertSent) {
        this._alertSent = true;
        this.alertCallback?.(
          `⚠️ **${this.name}** ne parvient pas à se reconnecter à <#${this.channelId}> ` +
          `(${this._reconnectAttempts} tentatives). Vérifiez les logs.`
        );
      }

      if (!this._broadcasting) return;

      // Tentative de reconnexion rapide sur la connexion existante
      try {
        if (
          this.connection &&
          this.connection.state.status !== VoiceConnectionStatus.Destroyed
        ) {
          await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
          logger.info(`Reconnexion rapide réussie`, { name: this.name });
          return;
        }
      } catch {
        logger.warn(`Reconnexion rapide échouée, reconnexion complète...`, { name: this.name });
      }

      // Reconnexion complète — rejoindre à nouveau le canal
      this._setupConnection(channel);
    }, delay);
  }

  _startStream() {
    if (this.pcmStream) {
      this.dispatcher.unregisterRelay(this.relayId);
      this.pcmStream.stop();
    }

    this.pcmStream = new ContinuousPCMStream({ name: this.name });

    // StreamType.Raw = PCM s16le brut, @discordjs/voice encode en Opus
    this.resource = createAudioResource(this.pcmStream, {
      inputType:    StreamType.Raw,
      inlineVolume: false,
    });

    this.pcmStream.start();
    this.player.play(this.resource);
  }

  _restartStream() {
    if (!this._broadcasting) return;
    setTimeout(() => {
      if (this._broadcasting) {
        this._startStream();
        // Ré-enregistrer le nouveau stream auprès du dispatcher
        if (this._registered) {
          this.dispatcher.registerRelay(this.relayId, this.pcmStream);
        }
      }
    }, 250);
  }

  async stopBroadcast() {
    if (!this._broadcasting) return;
    this._broadcasting = false;
    this._connected    = false;
    this._registered   = false;
    this._alertSent    = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this.dispatcher.unregisterRelay(this.relayId);

    if (this.pcmStream) {
      this.pcmStream.stop();
      this.pcmStream = null;
    }
    if (this.player) {
      this.player.stop();
      this.player = null;
    }
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    logger.info(`Broadcast arrêté`, { name: this.name });
  }

  async destroy() {
    await this.stopBroadcast();
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
  }

  // ── Permissions ───────────────────────────────────────────────────────────

  /**
   * Vérifie que le bot a les permissions nécessaires sur son canal cible.
   * @returns {Promise<string[]>} Liste des permissions manquantes (vide = OK)
   */
  async checkPermissions() {
    try {
      const guild   = await this.client.guilds.fetch(this.guildId);
      const channel = await guild.channels.fetch(this.channelId);
      const me      = guild.members.cache.get(this.client.user.id)
                      ?? await guild.members.fetch(this.client.user.id);
      const perms   = channel.permissionsFor(me);

      const required = {
        ViewChannel: PermissionFlagsBits.ViewChannel,
        Connect:     PermissionFlagsBits.Connect,
        Speak:       PermissionFlagsBits.Speak,
        UseVAD:      PermissionFlagsBits.UseVAD,
      };

      return Object.entries(required)
        .filter(([, flag]) => !perms.has(flag))
        .map(([name]) => name);
    } catch (err) {
      logger.warn(`Impossible de vérifier les permissions`, { name: this.name, error: err.message });
      return [];
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      name:              this.name,
      channelId:         this.channelId,
      connected:         this._connected,
      broadcasting:      this._broadcasting,
      registered:        this._registered,
      disabled:          this._disabled,
      reconnectAttempts: this._reconnectAttempts,
      playerStatus:      this.player?.state?.status ?? "none",
      queueDepth:        this.pcmStream?.queueDepth ?? 0,
    };
  }
}

module.exports = RelayBot;
