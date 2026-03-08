"use strict";

/**
 * audio-stream.js — ContinuousPCMStream
 *
 * Stream Readable passif — pas de timer interne.
 * C'est le Dispatcher qui pousse les frames (audio ou silence) toutes les 20ms.
 * Cela élimine toute dérive entre deux timers indépendants.
 */

const { Readable } = require("stream");
const config = require("../config");

class ContinuousPCMStream extends Readable {
  constructor(options = {}) {
    super({
      highWaterMark: config.pcmFrameSize * 4,
    });

    this._name        = options.name || "unnamed";
    this._isRunning   = false;
    this._frameCount  = 0;
    this._silenceCount= 0;
  }

  start() {
    this._isRunning = true;
  }

  /**
   * Pousse une frame PCM directement dans le stream Node.js.
   * Appelé par le Dispatcher toutes les 20ms.
   * @param {Buffer} frame
   */
  pushFrame(frame) {
    if (!this._isRunning) return;

    // Normalisation taille
    let f = frame;
    if (f.length !== config.pcmFrameSize) {
      f = Buffer.alloc(config.pcmFrameSize);
      frame.copy(f, 0, 0, Math.min(frame.length, config.pcmFrameSize));
    }

    this.push(f);
    this._frameCount++;
  }

  /**
   * Pousse une frame de silence.
   * Appelé par le Dispatcher quand aucun speaker n'est actif.
   */
  pushSilence() {
    if (!this._isRunning) return;
    this.push(Buffer.alloc(config.pcmFrameSize, 0));
    this._silenceCount++;
  }

  get queueDepth() {
    return 0; // Pas de queue interne — le stream Node.js gère le buffering
  }

  getStats() {
    return {
      name:         this._name,
      frameCount:   this._frameCount,
      silenceCount: this._silenceCount,
      isRunning:    this._isRunning,
    };
  }

  stop() {
    if (!this._isRunning) return;
    this._isRunning = false;
    this.push(null);
  }

  flush() {}

  _read() {}

  _destroy(err, callback) {
    this._isRunning = false;
    callback(err);
  }
}

module.exports = ContinuousPCMStream;
