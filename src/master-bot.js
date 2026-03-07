"use strict";

/**
 * master-bot.js — MasterBot
 *
 * Responsabilités :
 *   - Rejoindre le canal source (Shotcallers)
 *   - Capturer l'audio de tous les speakers actifs (PCM s16le)
 *   - Alimenter l'AudioDispatcher frame par frame
 *   - Gérer les slash commands (/start /stop /status)
 *
 * Pipeline réception audio :
 *   Discord UDP
 *     → VoiceConnection.receiver
 *     → AudioReceiveStream (PCM via @discordjs/opus)
 *     → dispatcher.onAudioFrame(userId, pcmChunk)
 */

const { Client, GatewayIntentBits, REST, Routes, Collection } = require("discord.js");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
} = require("@discordjs/voice");

const config = require("./config");
const logger = require("./utils/logger").child("MasterBot");

const startCmd  = require("./commands/start");
const stopCmd   = require("./commands/stop");
const statusCmd = require("./commands/status");

class MasterBot {
  /** @param {import('./dispatcher')} dispatcher */
  constructor(dispatcher) {
    this.dispatcher = dispatcher;
    this.client     = null;
    this.connection = null;

    this._broadcasting   = false;
    this._activeSpeakers = new Set();
    this._speakerTimers  = new Map();

    // Référence vers les relay bots (injectée depuis index.js)
    this._relayBots = [];

    this.commands = new Collection();
    this.commands.set("start",  startCmd);
    this.commands.set("stop",   stopCmd);
    this.commands.set("status", statusCmd);
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
      logger.error("Client error", { error: err.message })
    );

    this.client.on("interactionCreate", (i) => this._handleInteraction(i));

    await this.client.login(config.masterToken);

    if (!this.client.isReady()) {
      await new Promise((resolve) => this.client.once("ready", resolve));
    }

    logger.info(`Master connecté`, { tag: this.client.user.tag });
  }

  /** Enregistre les slash commands (à appeler une fois). */
  async registerCommands() {
    const body = [startCmd, stopCmd, statusCmd].map((c) => c.data.toJSON());
    const rest = new REST().setToken(config.masterToken);

    await rest.put(
      Routes.applicationGuildCommands(this.client.user.id, config.guildId),
      { body }
    );

    logger.info("Slash commands enregistrées");
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────

  async startBroadcast() {
    if (this._broadcasting) return;

    const guild   = await this.client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(config.sourceChannelId);

    if (!channel?.isVoiceBased()) {
      throw new Error(`Canal source ${config.sourceChannelId} introuvable`);
    }

    logger.info(`Connexion au canal source`, { channel: channel.name });

    this.connection = joinVoiceChannel({
      channelId:      channel.id,
      guildId:        guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf:       false,  // OBLIGATOIRE pour recevoir l'audio
      selfMute:       true,   // Le master ne parle pas
      group:          'master',
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
      logger.info("Connexion voice source prête", { channel: channel.name });
    } catch (err) {
      logger.warn("Timeout connexion source (normal), on continue...", { channel: channel.name });
      // Ne pas throw — la connexion finit par s'établir
    }

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      logger.warn("Source déconnectée, reconnexion...");
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting,  5_000),
        ]);
      } catch {
        logger.error("Reconnexion source échouée. Arrêt du broadcast.");
        await this.stopBroadcast();
      }
    });

    this.dispatcher.start();
    this._startReceiving();
    this._broadcasting = true;

    logger.info(`Broadcast actif`, { source: channel.name });
  }

  _startReceiving() {
    const receiver = this.connection.receiver;

    receiver.speaking.on("start", (userId) => {
      if (this._activeSpeakers.has(userId)) return;
      this._activeSpeakers.add(userId);

      // Annuler le timer de silence si l'utilisateur reprend
      if (this._speakerTimers.has(userId)) {
        clearTimeout(this._speakerTimers.get(userId));
        this._speakerTimers.delete(userId);
      }

      // Souscrire au flux audio de cet utilisateur
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: config.silenceThresholdMs,
        },
      });

      audioStream.on("data", (chunk) => {
        this.dispatcher.onAudioFrame(userId, chunk);
      });

      audioStream.on("end",   () => this._onSpeakerSilence(userId));
      audioStream.on("error", () => this._onSpeakerSilence(userId));
    });

    receiver.speaking.on("end", (userId) => {
      if (this._speakerTimers.has(userId)) return;
      const t = setTimeout(() => {
        this._onSpeakerSilence(userId);
        this._speakerTimers.delete(userId);
      }, config.silenceThresholdMs);
      this._speakerTimers.set(userId, t);
    });

    logger.info("Réception audio démarrée");
  }

  _onSpeakerSilence(userId) {
    if (this._activeSpeakers.delete(userId)) {
      this.dispatcher.onSpeakerStop(userId);
    }
  }

  async stopBroadcast() {
    if (!this._broadcasting) return;
    this._broadcasting = false;

    for (const [, t] of this._speakerTimers) clearTimeout(t);
    this._speakerTimers.clear();
    this._activeSpeakers.clear();

    this.dispatcher.stop();

    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    logger.info("Broadcast arrêté");
  }

  // ── Commandes ─────────────────────────────────────────────────────────────

  async _handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = this.commands.get(interaction.commandName);
    if (!command) return;

    const hasRole = interaction.member?.roles?.cache?.has(config.shotcallerRoleId);
    if (!hasRole) {
      await interaction.reply({
        content: "❌ Vous devez avoir le rôle **Shotcaller** pour utiliser cette commande.",
        ephemeral: true,
      });
      return;
    }

    try {
      await command.execute(interaction, this);
    } catch (err) {
      logger.error("Erreur commande", {
        command: interaction.commandName,
        error:   err.message,
      });
      const msg = { content: `❌ Erreur : ${err.message}`, ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  get isBroadcasting() {
    return this._broadcasting;
  }

  getStatus() {
    return {
      broadcasting:     this._broadcasting,
      activeSpeakers:   [...this._activeSpeakers],
      connectionStatus: this.connection?.state?.status ?? "disconnected",
    };
  }

  async destroy() {
    await this.stopBroadcast();
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
  }
}

module.exports = MasterBot;
