import { JPEG, wsPair } from './helpers.js';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { PiZeroDriver } from '../src/drivers/pi-zero.driver.js';

const device = { id: 7, roomId: 3, name: 'pi' };
let pair;
afterEach(() => pair?.close());

/** Fake Pi: answers every capture with `shots` JPEG frames. */
function fakePi(client, { frame = JPEG, header = true, done = true } = {}) {
  client.on('message', (data, isBinary) => {
    if (isBinary) return;
    const msg = JSON.parse(data);
    if (msg.cmd !== 'capture') return;
    for (let seq = 0; seq < msg.shots; seq++) {
      if (header) client.send(JSON.stringify({ type: 'frame', requestId: msg.requestId, seq, position: msg.pan?.[seq] ?? null }));
      client.send(frame, { binary: true });
    }
    if (done) client.send(JSON.stringify({ type: 'capture_done', requestId: msg.requestId }));
  });
}

describe('PiZeroDriver', () => {
  it('captures the G·C·D scan with positions and sequence numbers', async () => {
    pair = await wsPair();
    fakePi(pair.client);
    const driver = new PiZeroDriver(pair.serverSide, device);
    const frames = await driver.capture({ mode: 'attendance', shots: 3, pan: [-40, 0, 40] });
    assert.deepEqual(frames.map((f) => [f.seq, f.position]), [[0, -40], [1, 0], [2, 40]]);
    assert.ok(frames.every((f) => f.buffer.equals(JPEG) && f.mime === 'image/jpeg'));
    assert.equal(driver.busy, false);
  });

  it('accepts bare binary frames without a header', async () => {
    pair = await wsPair();
    fakePi(pair.client, { header: false, done: false });
    const driver = new PiZeroDriver(pair.serverSide, device);
    const frames = await driver.capture({ mode: 'behavior', shots: 2 });
    assert.deepEqual(frames.map((f) => f.seq), [0, 1]);
  });

  it('rejects a frame that is not a JPEG', async () => {
    pair = await wsPair();
    fakePi(pair.client, { frame: Buffer.from('not an image') });
    const driver = new PiZeroDriver(pair.serverSide, device);
    await assert.rejects(driver.capture({ mode: 'behavior', shots: 1 }), { code: 'BAD_FRAME' });
  });

  it('times out when the device never answers', async () => {
    pair = await wsPair();
    const driver = new PiZeroDriver(pair.serverSide, device, { captureTimeoutMs: 100 });
    await assert.rejects(driver.capture({ mode: 'behavior', shots: 1 }), { code: 'CAPTURE_TIMEOUT' });
  });

  it('fails the pending capture when the device disconnects', async () => {
    pair = await wsPair();
    pair.client.on('message', () => pair.client.terminate());
    const driver = new PiZeroDriver(pair.serverSide, device);
    await assert.rejects(driver.capture({ mode: 'attendance', shots: 3 }), { code: 'CONNECTION_CLOSED' });
    assert.equal(driver.online, false);
  });

  it('forwards device-side errors', async () => {
    pair = await wsPair();
    pair.client.on('message', (d) => {
      const m = JSON.parse(d);
      pair.client.send(JSON.stringify({ type: 'error', requestId: m.requestId, message: 'camera busy' }));
    });
    const driver = new PiZeroDriver(pair.serverSide, device);
    await assert.rejects(driver.capture({ mode: 'test', shots: 1 }), { code: 'DEVICE_ERROR', message: 'camera busy' });
  });

  it('serialises concurrent captures (one camera, one capture at a time)', async () => {
    pair = await wsPair();
    let inFlight = 0;
    let maxInFlight = 0;
    pair.client.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.cmd !== 'capture') return;
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      setTimeout(() => {
        inFlight--;
        pair.client.send(JSON.stringify({ type: 'frame', requestId: m.requestId, seq: 0 }));
        pair.client.send(JPEG, { binary: true });
      }, 30);
    });
    const driver = new PiZeroDriver(pair.serverSide, device);
    await Promise.all([1, 2, 3].map(() => driver.capture({ mode: 'behavior', shots: 1 })));
    assert.equal(maxInFlight, 1);
  });

  it('updates info from hello and ping, and answers pong', async () => {
    pair = await wsPair();
    const driver = new PiZeroDriver(pair.serverSide, device);
    const pong = new Promise((r) => pair.client.on('message', (d) => JSON.parse(d).type === 'pong' && r()));
    pair.client.send(JSON.stringify({ type: 'hello', firmware: '1.0', camera: 'v3' }));
    pair.client.send(JSON.stringify({ type: 'ping', rssi: -60, cpuTemp: 50 }));
    await pong;
    assert.deepEqual(driver.info, { firmware: '1.0', camera: 'v3', rssi: -60, cpuTemp: 50 });
  });
});
