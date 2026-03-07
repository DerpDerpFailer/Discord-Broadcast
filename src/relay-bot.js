"use strict";

/**
 * relay-bot.js — RelayBot
 *
 * Un RelayBot par canal cible.
 * - Se connecte à Discord avec son propre token
 * - Rejoint son canal vocal cible au /start
 * - Crée un pipeline : ContinuousPCMStream → AudioResource → AudioPlayer
 * - Reçoit les frames depuis l'AudioDispatcher et les joue en temps réel
 *
 * Pipeline audio :
 *   Dispatcher.pushFrame()
 *     → ContinuousPCMStream (queue + silence)
 *     → createAudioResource(stream, { inputType: StreamType.Raw })
 *     → AudioPlayer
 *     → VoiceConnection (encode Opus interne)
 *     → Discord UDP → canal cible
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

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
      logger.info(`Connexion voice prête`, { name: this.name, channel: channel.name });
    } catch (err) {
      logger.warn(`Timeout connexion (normal), on continue...`, { name: this.name });
      // Ne pas throw — la connexion finit par s'établir
    }

    // Reconnexion automatique
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      logger.warn(`Déconnecté, tentative de reconnexion`, { name: this.name });
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting,  5_000),
        ]);
      } catch {
        logger.error(`Reconnexion échouée`, { name: this.name });
        this.connection.destroy();
        this._connected    = false;
        this._broadcasting = false;
      }
    });

    // Player audio
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on("error", (err) => {
      logger.error(`Player error`, { name: this.name, error: err.message });
      if (this._broadcasting) this._restartStream();
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this._broadcasting) {
        logger.warn(`Player idle, redémarrage stream`, { name: this.name });
        this._restartStream();
      }
    });

    this.connection.subscribe(this.player);
    this._startStream();

    this.dispatcher.registerRelay(this.relayId, this.pcmStream);

    this._connected    = true;
    this._broadcasting = true;

    logger.info(`Broadcast démarré`, { name: this.name, channel: channel.name });
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

    if (this._broadcasting) {
      this.dispatcher.registerRelay(this.relayId, this.pcmStream);
    }
  }

  _restartStream() {
    if (!this._broadcasting) return;
    setTimeout(() => {
      if (this._broadcasting) this._startStream();
    }, 250);
  }

  async stopBroadcast() {
    if (!this._broadcasting) return;
    this._broadcasting = false;
    this._connected    = false;

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
      playerStatus: this.player?.state?.status ?? "none",
      queueDepth:   this.pcmStream?.queueDepth ?? 0,
    };
  }
}

module.exports = RelayBot;
