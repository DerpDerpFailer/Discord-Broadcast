"use strict";

/**
 * mixer.js
 *
 * Mixage PCM brut (s16le, 48kHz, stéréo).
 * Additionne les échantillons de plusieurs speakers avec clamping int16.
 */

const config = require("../config");

/**
 * Mixe plusieurs buffers PCM en un seul.
 * @param {Buffer[]} buffers
 * @returns {Buffer}
 */
function mixPcm(buffers) {
  if (buffers.length === 0) return Buffer.alloc(config.pcmFrameSize);
  if (buffers.length === 1) return buffers[0];

  const length = Math.max(...buffers.map((b) => b.length));
  const aligned = length % 2 === 0 ? length : length + 1;
  const result = Buffer.alloc(aligned);

  for (let i = 0; i < aligned; i += 2) {
    let sample = 0;
    for (const buf of buffers) {
      if (i + 1 < buf.length) sample += buf.readInt16LE(i);
    }
    // Clamping pour éviter le clipping numérique
    if (sample > 32767)  sample = 32767;
    if (sample < -32768) sample = -32768;
    result.writeInt16LE(sample, i);
  }

  return result;
}

/**
 * Applique un multiplicateur de volume à un buffer PCM.
 * @param {Buffer} buffer
 * @param {number} volume - 0.0 à 2.0
 */
function applyVolume(buffer, volume) {
  if (volume === 1.0) return buffer;
  const result = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i += 2) {
    let s = Math.round(buffer.readInt16LE(i) * volume);
    if (s > 32767)  s = 32767;
    if (s < -32768) s = -32768;
    result.writeInt16LE(s, i);
  }
  return result;
}

/**
 * Vérifie si un buffer PCM est essentiellement silencieux.
 * @param {Buffer} buffer
 * @param {number} threshold - seuil RMS (0-32767)
 */
function isSilent(buffer, threshold = 100) {
  let sum = 0;
  const samples = buffer.length / 2;
  for (let i = 0; i < buffer.length; i += 2) {
    const s = buffer.readInt16LE(i);
    sum += s * s;
  }
  return Math.sqrt(sum / samples) < threshold;
}

module.exports = { mixPcm, applyVolume, isSilent };
