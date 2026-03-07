#!/usr/bin/env node
"use strict";

process.env.MASTER_BOT_TOKEN    = "test";
process.env.GUILD_ID            = "111";
process.env.SOURCE_CHANNEL_ID   = "222";
process.env.SHOTCALLER_ROLE_ID  = "333";
process.env.RELAY_BOT_TOKEN_1   = "relay1";
process.env.TARGET_CHANNEL_ID_1 = "444";

const AudioDispatcher = require("../src/dispatcher");
const config          = require("../src/config");

const NUM_RELAYS = 8;
const NUM_FRAMES = 500;

class BenchStream {
  constructor(id) {
    this.id = id;
    this.timestamps = [];
    this._isRunning = true;
    this.queueDepth = 0;
  }
  pushFrame() { this.timestamps.push(process.hrtime.bigint()); }
  flush() {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log("=== Benchmark Latence Interne ===");
  console.log(`Relays: ${NUM_RELAYS} | Frames: ${NUM_FRAMES} | Taille: ${config.pcmFrameSize}B\n`);

  const dispatcher = new AudioDispatcher();
  const relays = Array.from({ length: NUM_RELAYS }, (_, i) => {
    const r = new BenchStream(`relay-${i + 1}`);
    dispatcher.registerRelay(r.id, r);
    return r;
  });

  const sent = [];
  const frame = Buffer.alloc(config.pcmFrameSize, 42);

  dispatcher.start();

  for (let i = 0; i < NUM_FRAMES; i++) {
    sent.push(process.hrtime.bigint());
    dispatcher.onAudioFrame("bench", frame);
    await sleep(config.frameDurationMs);
  }

  await sleep(100);
  dispatcher.stop();

  const relay    = relays[0];
  const count    = Math.min(sent.length, relay.timestamps.length);
  const latencies = [];

  for (let i = 0; i < count; i++) {
    latencies.push(Number(relay.timestamps[i] - sent[i]) / 1_000_000);
  }

  if (latencies.length === 0) { console.log("Pas de données."); return; }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
  const p = (pct) => latencies[Math.floor(latencies.length * pct)];

  console.log("Latence dispatch interne (send → relay.pushFrame) :");
  console.log(`  Échantillons : ${latencies.length}`);
  console.log(`  Moyenne      : ${avg.toFixed(3)} ms`);
  console.log(`  P50          : ${p(0.50).toFixed(3)} ms`);
  console.log(`  P95          : ${p(0.95).toFixed(3)} ms`);
  console.log(`  P99          : ${p(0.99).toFixed(3)} ms`);
  console.log(`  Max          : ${p(1.00).toFixed(3)} ms`);

  console.log("\nFrames reçues par relay :");
  relays.forEach((r) => console.log(`  ${r.id}: ${r.timestamps.length} frames`));
}

run().catch(console.error);
