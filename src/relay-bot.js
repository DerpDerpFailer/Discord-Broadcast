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

const { Client, GatewayIntentBits } = require("discord.js");
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

    this._broadcasting = false;
    this._connected    = false;
    this._registered   = false;
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

    this.connection = joinVoiceChannel({
      channelId:       channel.id,
      guildId:         guild.id,
      adapterCreator:  guild.voiceAdapterCreator,
      selfDeaf:        false,
      selfMute:        false,
      group:           this.relayId,
    });

    this._broadcasting = true;
    this._registered   = false;

    // Créer le player tout de suite
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

    this.connection.subscribe(this.player);

    // Démarrer le stream PCM tout de suite — les frames s'accumulent en attendant Ready
    this._startStream();

    // S'enregistrer auprès du dispatcher UNIQUEMENT quand la connexion est Ready
    this.connection.on("stateChange", (oldState, newState) => {
      logger.info(`[${this.name}] ${oldState.status} -> ${newState.status}`);

      if (newState.status === VoiceConnectionStatus.Ready) {
        this._connected = true;
        logger.info(`Connexion voice prête`, { name: this.name, channel: channel.name });
        if (!this._registered) {
          this._registered = true;
          this.dispatcher.registerRelay(this.relayId, this.pcmStream);
          logger.info(`Broadcast démarré`, { name: this.name, channel: channel.name });
        }
      }

      if (newState.status === VoiceConnectionStatus.Disconnected) {
        if (!this._broadcasting) return;
        this._connected = false;
        logger.warn(`Déconnecté, reconnexion...`, { name: this.name });
        entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000)
          .catch(() => {
            logger.warn(`Reconnexion échouée`, { name: this.name });
            this._broadcasting = false;
          });
      }
    });
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

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      name:         this.name,
      channelId:    this.channelId,
      connected:    this._connected,
      broadcasting: this._broadcasting,
      registered:   this._registered,
      playerStatus: this.player?.state?.status ?? "none",
      queueDepth:   this.pcmStream?.queueDepth ?? 0,
    };
  }
}

module.exports = RelayBot;
