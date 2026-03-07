"use strict";

/**
 * audio-stream.js — ContinuousPCMStream
 *
 * Stream Readable qui émet des frames PCM (s16le, 48kHz, stéréo) toutes les 20ms.
 * - Si la queue est vide → émet une frame de silence (maintient la connexion voice)
 * - Si la queue a des frames → émet les frames dans l'ordre
 *
 * Utilisé par chaque RelayBot comme source pour son AudioPlayer.
 *
 * Pipeline complet :
 *   Dispatcher.pushFrame() → queue interne → _tick() → stream consumer
 *                                                        (AudioPlayer Discord)
 */

const { Readable } = require("stream");
const config = require("../config");

const SILENCE_FRAME = Buffer.alloc(config.pcmFrameSize, 0);

class ContinuousPCMStream extends Readable {
  constructor(options = {}) {
    super({
      ...options,
      highWaterMark: config.pcmFrameSize * 10,
    });

    this._name        = options.name || "unnamed";
    this._frameQueue  = [];
    this._isRunning   = false;
    this._interval    = null;
    this._frameCount  = 0;
    this._silenceCount= 0;
  }

  /** Démarre l'horloge 20ms. Appeler après que le stream ait un consumer. */
  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this._interval = setInterval(() => this._tick(), config.frameDurationMs);
    this._interval.unref();
  }

  _tick() {
    if (!this._isRunning) return;

    let frame;
    if (this._frameQueue.length > 0) {
      frame = this._frameQueue.shift();
      this._frameCount++;
    } else {
      frame = SILENCE_FRAME;
      this._silenceCount++;
    }

    const ok = this.push(frame);
    if (!ok && this._frameQueue.length > config.maxBufferFrames) {
      this._frameQueue.shift(); // Back-pressure : drop l'ancienne frame
    }
  }

  /**
   * Ajoute une frame PCM dans la queue de lecture.
   * @param {Buffer} frame
   */
  pushFrame(frame) {
    if (!this._isRunning) return;

    // Normalisation de la taille de frame
    if (frame.length !== config.pcmFrameSize) {
      const normalized = Buffer.alloc(config.pcmFrameSize);
      frame.copy(normalized, 0, 0, Math.min(frame.length, config.pcmFrameSize));
      frame = normalized;
    }

    // Anti-débordement
    if (this._frameQueue.length >= config.maxBufferFrames) {
      this._frameQueue.shift();
    }

    this._frameQueue.push(frame);
  }

  /** Vide la queue (utile à l'arrêt du broadcast). */
  flush() {
    this._frameQueue.length = 0;
  }

  get queueDepth() {
    return this._frameQueue.length;
  }

  getStats() {
    return {
      name:         this._name,
      queueDepth:   this._frameQueue.length,
      frameCount:   this._frameCount,
      silenceCount: this._silenceCount,
      isRunning:    this._isRunning,
    };
  }

  stop() {
    if (!this._isRunning) return;
    this._isRunning = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this.push(null);
  }

  _read() {}

  _destroy(err, callback) {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._isRunning = false;
    callback(err);
  }
}

module.exports = ContinuousPCMStream;
