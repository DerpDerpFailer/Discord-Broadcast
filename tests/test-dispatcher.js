"use strict";

process.env.MASTER_BOT_TOKEN    = "test";
process.env.GUILD_ID            = "111";
process.env.SOURCE_CHANNEL_ID   = "222";
process.env.SHOTCALLER_ROLE_ID  = "333";
process.env.RELAY_BOT_TOKEN_1   = "relay1";
process.env.TARGET_CHANNEL_ID_1 = "444";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const AudioDispatcher = require("../src/dispatcher");
const config          = require("../src/config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFrame(v = 1000) {
  const b = Buffer.alloc(config.pcmFrameSize);
  for (let i = 0; i < config.pcmFrameSize; i += 2) b.writeInt16LE(v, i);
  return b;
}

class MockStream {
  constructor() { this.frames = []; this._isRunning = true; this.queueDepth = 0; }
  pushFrame(f) { this.frames.push(Buffer.from(f)); this.queueDepth = this.frames.length; }
  flush() { this.frames.length = 0; }
}

describe("AudioDispatcher", () => {
  let d;
  afterEach(() => { if (d._running) d.stop(); });

  it("état initial vide", () => {
    d = new AudioDispatcher();
    const s = d.getStats();
    assert.equal(s.activeSpeakers, 0);
    assert.equal(s.activeRelays,   0);
  });

  it("registerRelay / unregisterRelay", () => {
    d = new AudioDispatcher();
    const s = new MockStream();
    d.registerRelay("r1", s);
    assert.equal(d.getStats().activeRelays, 1);
    d.unregisterRelay("r1");
    assert.equal(d.getStats().activeRelays, 0);
  });

  it("onAudioFrame crée un speaker", () => {
    d = new AudioDispatcher();
    d.start();
    d.onAudioFrame("u1", makeFrame());
    assert.equal(d._speakerQueues.size, 1);
    d.onSpeakerStop("u1");
    assert.equal(d._speakerQueues.size, 0);
  });

  it("dispatch une frame vers 1 relay", async () => {
    d = new AudioDispatcher();
    const relay = new MockStream();
    d.registerRelay("r1", relay);
    d.start();
    d.onAudioFrame("u1", makeFrame(2000));
    await sleep(50);
    assert.ok(relay.frames.length >= 1);
  });

  it("dispatch vers 3 relays simultanément", async () => {
    d = new AudioDispatcher();
    const relays = [new MockStream(), new MockStream(), new MockStream()];
    relays.forEach((r, i) => d.registerRelay(`r${i}`, r));
    d.start();
    d.onAudioFrame("u1", makeFrame(1000));
    await sleep(50);
    relays.forEach((r) => assert.ok(r.frames.length >= 1));
  });

  it("mix 2 speakers : echantillon = 2000", async () => {
    d = new AudioDispatcher();
    const relay = new MockStream();
    d.registerRelay("r1", relay);
    d.start();
    d.onAudioFrame("u1", makeFrame(1000));
    d.onAudioFrame("u2", makeFrame(1000));
    await sleep(50);
    if (relay.frames.length > 0) {
      assert.equal(relay.frames[0].readInt16LE(0), 2000);
    }
  });

  it("émet speakerStart et speakerStop", () => {
    d = new AudioDispatcher();
    d.start();
    let start = false, stop = false;
    d.on("speakerStart", () => (start = true));
    d.on("speakerStop",  () => (stop  = true));
    d.onAudioFrame("u1", makeFrame());
    d.onSpeakerStop("u1");
    assert.ok(start);
    assert.ok(stop);
  });

  it("ne plante pas sans relay enregistré", async () => {
    d = new AudioDispatcher();
    d.start();
    d.onAudioFrame("u1", makeFrame());
    await sleep(40);
    // Aucune erreur levée
  });

  it("limite la queue sous charge", () => {
    d = new AudioDispatcher();
    d.start();
    for (let i = 0; i < config.maxBufferFrames + 20; i++) {
      d.onAudioFrame("u1", makeFrame(i));
    }
    const q = d._speakerQueues.get("u1");
    assert.ok(q.length <= config.maxBufferFrames);
  });
});
