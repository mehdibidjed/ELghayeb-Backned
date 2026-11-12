#!/usr/bin/env node
// Simulates a Raspberry Pi Zero camera node (docs/device-protocol.md) so the
// whole pipeline can run without hardware.
//
//   DEVICE_TOKEN=dev_xxx npm run simulate:device
//   env: SERVER_URL (ws://localhost:3000), SIM_IMAGES_DIR (../vision_model/data/classroom)
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_URL = process.env.SERVER_URL ?? 'ws://localhost:3000';
const TOKEN = process.env.DEVICE_TOKEN;
const IMAGES_DIR = process.env.SIM_IMAGES_DIR ?? path.resolve(here, '../../vision_model/data/classroom');
const PING_MS = 30_000;

if (!TOKEN) {
  console.error('DEVICE_TOKEN is required (printed by `npm run db:seed` or POST /api/devices).');
  process.exit(1);
}

const files = (await readdir(IMAGES_DIR)).filter((f) => /\.jpe?g$/i.test(f)).sort();
if (!files.length) {
  console.error(`No JPEG in ${IMAGES_DIR}`);
  process.exit(1);
}
const images = await Promise.all(files.map((f) => readFile(path.join(IMAGES_DIR, f))));
console.log(`[sim] ${images.length} image(s) from ${IMAGES_DIR}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0;
let retry = 1000;

function connect() {
  const ws = new WebSocket(`${SERVER_URL}/ws/device?token=${encodeURIComponent(TOKEN)}`);
  let pinger;

  ws.on('open', () => {
    retry = 1000;
    console.log('[sim] connected');
    ws.send(
      JSON.stringify({
        type: 'hello',
        firmware: 'sim-0.1',
        camera: 'simulated (Pi Camera v3 12MP)',
        resolution: '4608x2592',
        hostname: os.hostname(),
        servo: true,
      }),
    );
    const ping = () => ws.send(JSON.stringify({ type: 'ping', rssi: -55, cpuTemp: 48.2, uptime: Math.round(process.uptime()) }));
    ping();
    pinger = setInterval(ping, PING_MS);
  });

  ws.on('message', async (data, isBinary) => {
    if (isBinary) return;
    const msg = JSON.parse(data.toString());
    if (msg.type === 'welcome') return console.log(`[sim] welcome: device #${msg.deviceId}, room ${msg.roomId}`);
    if (msg.cmd !== 'capture') return;

    const { requestId, mode, shots, pan, countdown } = msg;
    console.log(`[sim] capture ${mode} × ${shots}${pan ? ` pan ${pan.join('/')}` : ''}${countdown ? `, countdown ${countdown}s` : ''}`);
    for (let s = countdown ?? 0; s > 0; s--) await sleep(1000); // LED 3·2·1
    for (let seq = 0; seq < shots; seq++) {
      if (pan) await sleep(300); // servo move
      const img = images[next++ % images.length];
      ws.send(JSON.stringify({ type: 'frame', requestId, seq, position: pan?.[seq] ?? null, size: img.length }));
      ws.send(img, { binary: true });
    }
    ws.send(JSON.stringify({ type: 'capture_done', requestId }));
  });

  ws.on('close', (code, reason) => {
    clearInterval(pinger);
    console.log(`[sim] disconnected (${code} ${reason}), retrying in ${retry / 1000}s`);
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 30_000);
  });
  ws.on('error', (err) => console.error(`[sim] ${err.message}`));
}

connect();
