"use strict";

/**
 * master-bot.js — MasterBot
 *
 * Responsabilités :
 *   - Rejoindre le canal source (Shotcallers)
 *   - Capturer l'audio de tous les speakers actifs (PCM s16le)
 *   - Alimenter l'AudioDispatcher frame par frame
 *   - Gérer les slash commands (/start /stop /status)
 */

const { Client, GatewayIntentBits, REST, Routes, Collection } = require("discord.js");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  EndBehaviorType,
  entersState,
} = require("@discordjs/voice");

const config = require("./config");
const logger = require("./utils/logger").child("MasterBot");

const startCmd  = require("./commands/start");
const stopCmd   = require("./commands/stop");
const statusCmd = require("./commands/status");
const setupCmd  = require("./commands/setup");

// Backoff exponentiel : 2s, 4s, 8s, 16s, 30s max
const RECONNECT_DELAYS = [2000, 4000, 8000, 16000, 30000];

class MasterBot {
  /** @param {import('./dispatcher')} dispatcher */
  constructor(dispatcher) {
    this.dispatcher = dispatcher;
    this.client     = null;
    this.connection = null;

    this._broadcasting      = false;
    this._receiverStarted   = false;
    this._activeSpeakers    = new Set();
    this._speakerTimers     = new Map();
    this._relayBots         = [];
    this._reconnectAttempts = 0;
    this._reconnectTimer    = null;

    this.commands = new Collection();
    this.commands.set("start",  startCmd);
    this.commands.set("stop",   stopCmd);
    this.commands.set("status", statusCmd);
    this.commands.set("setup",  setupCmd);
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
    const body = [startCmd, stopCmd, statusCmd, setupCmd].map((c) => c.data.toJSON());
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

    this._broadcasting      = true;
    this._receiverStarted   = false;
    this._reconnectAttempts = 0;

    this._setupConnection(channel);
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
      selfMute:       true,
      group:          "master",
    });

    this.connection.on("stateChange", (oldState, newState) => {
      logger.info(`Connexion source : ${oldState.status} -> ${newState.status}`);

      if (newState.status === VoiceConnectionStatus.Ready) {
        this._reconnectAttempts = 0;
        logger.info("Connexion voice source prête", { channel: channel.name });
        if (!this._receiverStarted) {
          this._receiverStarted = true;
          this.dispatcher.start();
          this._startReceiving();
          logger.info(`Broadcast actif`, { source: channel.name });
        }
      }

      if (
        newState.status === VoiceConnectionStatus.Disconnected ||
        newState.status === VoiceConnectionStatus.Destroyed
      ) {
        if (!this._broadcasting) return;
        logger.warn(`Source ${newState.status}, reconnexion...`);
        this._scheduleReconnect(channel);
      }
    });
  }

  _scheduleReconnect(channel) {
    if (!this._broadcasting) return;
    if (this._reconnectTimer) return;

    const attempt = this._reconnectAttempts;
    const delay   = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];

    logger.info(`Reconnexion source dans ${delay / 1000}s (tentative ${attempt + 1})`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer    = null;
      this._reconnectAttempts = attempt + 1;

      if (!this._broadcasting) return;

      try {
        if (
          this.connection &&
          this.connection.state.status !== VoiceConnectionStatus.Destroyed
        ) {
          await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
          logger.info(`Reconnexion source rapide réussie`);
          return;
        }
      } catch {
        logger.warn(`Reconnexion rapide échouée, reconnexion complète...`);
      }

      this._receiverStarted = false;
      this._setupConnection(channel);
    }, delay);
  }

  _startReceiving() {
    const receiver = this.connection.receiver;
    const prism = require("prism-media");

    receiver.speaking.on("start", (userId) => {
      if (this._activeSpeakers.has(userId)) return;
      this._activeSpeakers.add(userId);

      if (this._speakerTimers.has(userId)) {
        clearTimeout(this._speakerTimers.get(userId));
        this._speakerTimers.delete(userId);
      }

      // Récupérer le flux Opus brut depuis Discord
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: config.silenceThresholdMs,
        },
      });

      // Décoder Opus → PCM s16le 48kHz stéréo
      const decoder = new prism.opus.Decoder({
        rate:      48000,
        channels:  2,
        frameSize: 960,
      });

      // Pipeline : Opus → Decoder → PCM → Dispatcher
      opusStream.pipe(decoder);

      decoder.on("data", (pcmChunk) => {
        // Le décodeur Opus produit exactement 3840 bytes par frame (960 samples × 2ch × 2bytes)
        // Envoi direct sans bufferisation pour minimiser la latence
        this.dispatcher.onAudioFrame(userId, pcmChunk);
      });

      decoder.on("error", (err) => {
        if (!err.message.includes("decode")) {
          logger.error("Erreur décodeur Opus", { userId, error: err.message });
        }
      });

      opusStream.on("error", (err) => {
        if (!err.message.includes("decrypt")) {
          logger.error("Erreur flux Opus", { userId, error: err.message });
        }
      });

      opusStream.on("end", () => {
        decoder.destroy();
        this._onSpeakerSilence(userId);
      });
    });

    receiver.speaking.on("end", (userId) => {
      if (this._speakerTimers.has(userId)) return;
      const t = setTimeout(() => {
        this._onSpeakerSilence(userId);
        this._speakerTimers.delete(userId);
      }, config.silenceThresholdMs);
      this._speakerTimers.set(userId, t);
    });

    logger.info("Réception audio démarrée (Opus → PCM)");
  }

  _onSpeakerSilence(userId) {
    if (this._activeSpeakers.delete(userId)) {
      this.dispatcher.onSpeakerStop(userId);
    }
  }

  async stopBroadcast() {
    if (!this._broadcasting) return;
    this._broadcasting    = false;
    this._receiverStarted = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

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
    // ── Composants du wizard /setup (boutons, menus) ───────────────────
    if (interaction.isMessageComponent() && interaction.customId.startsWith("setup:")) {
      try {
        await setupCmd.handleComponent(interaction, this);
      } catch (err) {
        logger.error("Erreur setup component", { error: err.message });
      }
      return;
    }

    // ── Modales du wizard /setup ───────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith("setup_modal:")) {
      try {
        await setupCmd.handleModal(interaction, this);
      } catch (err) {
        logger.error("Erreur setup modal", { error: err.message });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = this.commands.get(interaction.commandName);
    if (!command) return;

    const configuredRole  = interaction.guild?.roles?.cache?.get(config.shotcallerRoleId);
    const roleExistsHere  = !!configuredRole;

    // Si le rôle configuré n'existe pas sur ce serveur → fallback Administrator
    // (permet de bootstrapper /setup sur un nouveau serveur sans chicken-and-egg)
    const hasRole = roleExistsHere
      ? interaction.member?.roles?.cache?.has(config.shotcallerRoleId)
      : interaction.member?.permissions?.has("Administrator");

    if (!hasRole) {
      const hint = roleExistsHere
        ? `Vous devez avoir le rôle **${configuredRole.name}** pour utiliser cette commande.`
        : `Aucun rôle autorisé configuré sur ce serveur.\nUtilisez \`/setup\` en tant qu'**Administrateur** pour en définir un.`;
      await interaction.reply({ content: `❌ ${hint}`, ephemeral: true });
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
      broadcasting:      this._broadcasting,
      activeSpeakers:    [...this._activeSpeakers],
      connectionStatus:  this.connection?.state?.status ?? "disconnected",
      reconnectAttempts: this._reconnectAttempts,
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
