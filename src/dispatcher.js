"use strict";

/**
 * dispatcher.js — AudioDispatcher
 *
 * Cœur du système. Tourne sur un tick de 20ms.
 *
 * Rôle :
 *   1. Reçoit les frames PCM de chaque speaker (via onAudioFrame)
 *   2. À chaque tick : mixe toutes les frames en attente
 *   3. Pousse la frame mixée vers chaque ContinuousPCMStream des relay bots
 *
 * Architecture interne :
 *
 *   onAudioFrame(userId, pcm) → _speakerQueues[userId][]
 *
 *   _tick() toutes les 20ms :
 *     → prend 1 frame par speaker
 *     → mixPcm([frame1, frame2, ...])
 *     → pour chaque relay : stream.pushFrame(mixedFrame)
 */

const EventEmitter = require("events");
const config       = require("./config");
const { mixPcm }   = require("./voice/mixer");
const logger       = require("./utils/logger").child("Dispatcher");

class AudioDispatcher extends EventEmitter {
  constructor() {
    super();

    /** @type {Map<string, Buffer[]>} userId → queue de frames */
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
   * Appelé par MasterBot pour chaque chunk PCM reçu d'un speaker.
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
    if (this._speakerQueues.size === 0) return;
    if (this._relayStreams.size   === 0) return;

    const frames = [];
    const toDelete = [];

    for (const [userId, queue] of this._speakerQueues) {
      if (queue.length > 0) {
        frames.push(queue.shift());
        if (queue.length === 0) toDelete.push(userId);
      }
    }

    for (const uid of toDelete) this._speakerQueues.delete(uid);
    if (frames.length === 0) return;

    const mixed = mixPcm(frames);

    for (const [relayId, stream] of this._relayStreams) {
      try {
        stream.pushFrame(mixed);
      } catch (err) {
        logger.error(`Erreur push frame relay`, { relayId, error: err.message });
      }
    }

    this._stats.totalFramesDispatched++;
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
