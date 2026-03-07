"use strict";

// Injecter les env vars avant tout require
process.env.MASTER_BOT_TOKEN    = "test";
process.env.GUILD_ID            = "111";
process.env.SOURCE_CHANNEL_ID   = "222";
process.env.SHOTCALLER_ROLE_ID  = "333";
process.env.RELAY_BOT_TOKEN_1   = "relay1";
process.env.TARGET_CHANNEL_ID_1 = "444";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const config           = require("../src/config");
const ContinuousPCMStream = require("../src/voice/audio-stream");
const { mixPcm, applyVolume, isSilent } = require("../src/voice/mixer");

function makeFrame(value = 1000, size = config.pcmFrameSize) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i += 2) buf.writeInt16LE(value, i);
  return buf;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ContinuousPCMStream ────────────────────────────────────────────────────

describe("ContinuousPCMStream", () => {
  it("crée un stream arrêté par défaut", () => {
    const s = new ContinuousPCMStream({ name: "t" });
    assert.equal(s._isRunning, false);
    assert.equal(s.queueDepth, 0);
    s.destroy();
  });

  it("émet des données après start()", async () => {
    const s = new ContinuousPCMStream({ name: "emit" });
    const frames = [];
    s.on("data", (c) => frames.push(c));
    s.start();
    await sleep(70);
    s.stop();
    assert.ok(frames.length >= 2, `Attendu >= 2, obtenu ${frames.length}`);
  });

  it("émet du silence quand la queue est vide", async () => {
    const s = new ContinuousPCMStream({ name: "silence" });
    const SILENCE = Buffer.alloc(config.pcmFrameSize, 0);
    const frames = [];
    s.on("data", (c) => frames.push(c));
    s.start();
    await sleep(50);
    s.stop();
    frames.forEach((f) => assert.deepEqual(f, SILENCE));
  });

  it("émet la frame poussée avant le silence", async () => {
    const s = new ContinuousPCMStream({ name: "push" });
    const testFrame = makeFrame(5000);
    let got = false;
    s.on("data", (c) => { if (c.equals(testFrame)) got = true; });
    s.start();
    s.pushFrame(testFrame);
    await sleep(50);
    s.stop();
    assert.ok(got, "Frame non reçue");
  });

  it("limite la profondeur de queue (back-pressure)", () => {
    const s = new ContinuousPCMStream({ name: "bp" });
    for (let i = 0; i < config.maxBufferFrames + 10; i++) s.pushFrame(makeFrame(i));
    assert.ok(s.queueDepth <= config.maxBufferFrames);
    s.destroy();
  });

  it("flush() vide la queue", () => {
    const s = new ContinuousPCMStream({ name: "flush" });
    s.pushFrame(makeFrame(1));
    s.pushFrame(makeFrame(2));
    assert.equal(s.queueDepth, 2);
    s.flush();
    assert.equal(s.queueDepth, 0);
    s.destroy();
  });
});

// ── Mixer ──────────────────────────────────────────────────────────────────

describe("PCM Mixer", () => {
  it("1 buffer → retourné tel quel", () => {
    const b = makeFrame(1234);
    assert.deepEqual(mixPcm([b]), b);
  });

  it("2 buffers identiques → somme correcte", () => {
    const b = makeFrame(1000);
    const r = mixPcm([b, b]);
    for (let i = 0; i < r.length; i += 2)
      assert.equal(r.readInt16LE(i), 2000);
  });

  it("clampage int16 max", () => {
    const b = makeFrame(20000);
    const r = mixPcm([b, b]); // 40000 > 32767
    for (let i = 0; i < r.length; i += 2)
      assert.equal(r.readInt16LE(i), 32767);
  });

  it("clampage int16 min", () => {
    const b = makeFrame(-20000);
    const r = mixPcm([b, b]); // -40000 < -32768
    for (let i = 0; i < r.length; i += 2)
      assert.equal(r.readInt16LE(i), -32768);
  });

  it("tableau vide → buffer de silence", () => {
    const r = mixPcm([]);
    assert.equal(r.length, config.pcmFrameSize);
  });

  it("applyVolume 0.5 divise par 2", () => {
    const b = makeFrame(2000);
    const r = applyVolume(b, 0.5);
    for (let i = 0; i < r.length; i += 2)
      assert.equal(r.readInt16LE(i), 1000);
  });

  it("isSilent détecte le silence", () => {
    assert.ok(isSilent(Buffer.alloc(config.pcmFrameSize, 0)));
    assert.ok(!isSilent(makeFrame(10000)));
  });
});
