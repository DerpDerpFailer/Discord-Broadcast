"use strict";

/**
 * dispatcher.js — AudioDispatcher
 *
 * Cœur du système. Tick unique de 20ms.
 *
 * À chaque tick :
 *   - Si des speakers sont actifs → mixe leurs frames → pushFrame() aux relays
 *   - Si aucun speaker → pushSilence() aux relays (maintient la connexion voice)
 *
 * Un seul timer pour tout le système — zéro dérive entre dispatcher et streams.
 */

const EventEmitter = require("events");
const config       = require("./config");
const { mixPcm }   = require("./voice/mixer");
const logger       = require("./utils/logger").child("Dispatcher");

class AudioDispatcher extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<string, Buffer[]>} userId → queue de frames PCM */
    this._speakerQueues = new Map();

    /** @type {Map<string, import('./voice/audio-stream')>} relayId → stream */
    this._relayStreams = new Map();

    this._running  = false;
    this._interval = null;

    this._stats = {
      totalFramesDispatched: 0,
      totalFramesDropped:    0,
      startedAt:             null,
    };

    this._lastFrameAt = null; // timestamp de la dernière frame audio réelle émise
  }

  // ── Gestion des relays ────────────────────────────────────────────────────

  registerRelay(relayId, stream) {
    this._relayStreams.set(relayId, stream);
    logger.info(`Relay enregistré`, { relayId, total: this._relayStreams.size });
  }

  unregisterRelay(relayId) {
    this._relayStreams.delete(relayId);
    logger.info(`Relay désenregistré`, { relayId, total: this._relayStreams.size });
  }

  // ── Réception audio ───────────────────────────────────────────────────────

  /**
   * Appelé par MasterBot pour chaque chunk PCM décodé d'un speaker.
   * @param {string} userId
   * @param {Buffer} pcmFrame
   */
  onAudioFrame(userId, pcmFrame) {
    if (!this._running) return;

    if (!this._speakerQueues.has(userId)) {
      this._speakerQueues.set(userId, []);
      this.emit("speakerStart", userId);
      logger.debug(`Speaker actif`, { userId });
    }

    const queue = this._speakerQueues.get(userId);

    if (queue.length >= config.maxBufferFrames) {
      queue.shift();
      this._stats.totalFramesDropped++;
    }

    queue.push(pcmFrame);
  }

  /**
   * Appelé quand un utilisateur arrête de parler.
   * @param {string} userId
   */
  onSpeakerStop(userId) {
    if (this._speakerQueues.delete(userId)) {
      this.emit("speakerStop", userId);
      logger.debug(`Speaker arrêté`, { userId });
    }
  }

  // ── Boucle de dispatch ────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running = true;
    this._stats.startedAt = Date.now();

    this._interval = setInterval(() => this._tick(), config.frameDurationMs);
    this._interval.unref();

    logger.info(`Dispatcher démarré`, {
      frameDurationMs: config.frameDurationMs,
      relays:          this._relayStreams.size,
    });
  }

  stop() {
    if (!this._running) return;
    this._running = false;

    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }

    this._speakerQueues.clear();

    logger.info(`Dispatcher arrêté`, {
      totalDispatched: this._stats.totalFramesDispatched,
      totalDropped:    this._stats.totalFramesDropped,
    });

    this.emit("stopped");
  }

  _tick() {
    if (this._relayStreams.size === 0) return;

    // Cas : aucun speaker actif → silence (maintient la connexion voice active)
    if (this._speakerQueues.size === 0) {
      for (const stream of this._relayStreams.values()) {
        try { stream.pushSilence(); } catch {}
      }
      return;
    }

    // Cas : un ou plusieurs speakers → mixer leurs frames
    const frames = [];

    for (const [userId, queue] of this._speakerQueues) {
      if (queue.length > 0) {
        frames.push(queue.shift());
      }
      // Nettoyer les queues vides (le speaker a fini)
      if (queue.length === 0) {
        this._speakerQueues.delete(userId);
      }
    }

    if (frames.length === 0) {
      for (const stream of this._relayStreams.values()) {
        try { stream.pushSilence(); } catch {}
      }
      return;
    }

    const mixed = mixPcm(frames);

    for (const [relayId, stream] of this._relayStreams) {
      try {
        stream.pushFrame(mixed);
        this._stats.totalFramesDispatched++;
        this._lastFrameAt = Date.now();
      } catch (err) {
        logger.error(`Erreur push frame relay`, { relayId, error: err.message });
      }
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getStats() {
    return {
      ...this._stats,
      activeSpeakers: this._speakerQueues.size,
      activeRelays:   this._relayStreams.size,
      uptimeMs:       this._stats.startedAt
        ? Date.now() - this._stats.startedAt
        : 0,
    };
  }
}

module.exports = AudioDispatcher;
