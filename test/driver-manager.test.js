import './helpers.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { DriverManager } from '../src/services/driver-manager.service.js';

class FakeDriver extends EventEmitter {
  constructor(deviceId, roomId) {
    super();
    this.deviceId = deviceId;
    this.roomId = roomId;
    this.online = true;
    this.lastSeen = new Date();
    this.connectedAt = new Date();
    this.info = {};
    this.pings = 0;
  }
  close(reason) {
    this.online = false;
    this.closedWith = reason;
    this.emit('close', reason);
  }
  ping() {
    this.pings++;
  }
  capture = async (opts) => [{ seq: 0, opts }];
  toJSON() {
    return { deviceId: this.deviceId, online: this.online };
  }
}

describe('DriverManager', () => {
  it('routes captures to the online camera of a room', async () => {
    const m = new DriverManager();
    m.register(new FakeDriver(1, 10));
    m.register(new FakeDriver(2, 20));
    const [frame] = await m.captureFromRoom(20, { mode: 'behavior', shots: 1 });
    assert.equal(frame.opts.mode, 'behavior');
    assert.equal(m.getByRoom(10).deviceId, 1);
    await assert.rejects(m.captureFromRoom(99, {}), { code: 'DEVICE_OFFLINE' });
  });

  it('emits online/offline and forgets closed drivers', () => {
    const m = new DriverManager();
    const events = [];
    m.on('online', (d) => events.push(['online', d.deviceId]));
    m.on('offline', (e) => events.push(['offline', e.deviceId]));
    const d = m.register(new FakeDriver(1, 10));
    d.close('bye');
    assert.deepEqual(events, [['online', 1], ['offline', 1]]);
    assert.equal(m.getByRoom(10), undefined);
  });

  it('replaces a previous connection of the same device without a false offline event', () => {
    const m = new DriverManager();
    let offline = 0;
    m.on('offline', () => offline++);
    const first = m.register(new FakeDriver(1, 10));
    const second = m.register(new FakeDriver(1, 10));
    assert.equal(first.closedWith, 'replaced by a new connection');
    assert.equal(m.get(1), second);
    assert.equal(offline, 0);
  });

  it('drops drivers whose heartbeat is lost and pings the others', () => {
    const m = new DriverManager({ heartbeatTimeoutMs: 1000 });
    const stale = m.register(new FakeDriver(1, 10));
    const fresh = m.register(new FakeDriver(2, 20));
    stale.lastSeen = new Date(Date.now() - 5000);
    m.sweep();
    assert.equal(stale.closedWith, 'heartbeat timeout');
    assert.equal(fresh.pings, 1);
    assert.deepEqual(m.list().map((d) => d.deviceId), [2]);
  });

  it('follows a device moved to another room', () => {
    const m = new DriverManager();
    m.register(new FakeDriver(1, 10));
    m.updateDevice(1, { roomId: 30 });
    assert.equal(m.getByRoom(10), undefined);
    assert.equal(m.getByRoom(30).deviceId, 1);
  });

  it('persists status through the injected store', async () => {
    const touched = [];
    const m = new DriverManager({ store: { touch: async (id, data) => touched.push([id, data.ip]) } });
    m.register(new FakeDriver(1, 10), { ip: '10.0.0.5' });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(touched[0], [1, '10.0.0.5']);
  });
});
