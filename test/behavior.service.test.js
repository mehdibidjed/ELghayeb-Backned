import './helpers.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bus } from '../src/lib/events.js';
import { BehaviorService } from '../src/services/behavior.service.js';

/** In-memory stand-in for the two Prisma models the service uses. */
function fakeDb() {
  const rows = new Map();
  const key = (w) => `${w.sessionId_minute.sessionId}|${w.sessionId_minute.minute.toISOString()}`;
  return {
    rows,
    session: { update: async () => ({}), findMany: async () => [] },
    behaviorStat: {
      findUnique: async ({ where }) => rows.get(key(where)) ?? null,
      upsert: async ({ where, create, update }) => {
        const k = key(where);
        rows.set(k, rows.has(k) ? { ...rows.get(k), ...update } : { ...create });
        return rows.get(k);
      },
    },
  };
}

const frame = (s, extra) => ({ sessionId: 1, persons: 10, attentive: 8, phone: 1, headDown: 2, handUp: 1, ...extra, capturedAt: new Date(Date.UTC(2026, 10, 11, 8, 0, s)).toISOString() });

describe('BehaviorService aggregation', () => {
  it('averages class percentages per minute', async () => {
    const svc = new BehaviorService({ db: fakeDb(), manager: {}, enqueue: async () => {} });
    await svc.recordFrame(frame(0));
    const stats = await svc.recordFrame(frame(10, { attentive: 6, phone: 3 }));
    assert.equal(stats.samples, 2);
    assert.equal(stats.attentivePct, 70); // (80 + 60) / 2
    assert.equal(stats.phonePct, 20); // (10 + 30) / 2
    assert.equal(stats.handUpPct, 10);
  });

  it('starts a new row each minute', async () => {
    const db = fakeDb();
    const svc = new BehaviorService({ db, manager: {}, enqueue: async () => {} });
    await svc.recordFrame(frame(50));
    await svc.recordFrame(frame(70)); // 08:01:10
    assert.equal(db.rows.size, 2);
  });

  it('ignores empty frames for the averages but still notifies', async () => {
    const db = fakeDb();
    const svc = new BehaviorService({ db, manager: {}, enqueue: async () => {} });
    let updates = 0;
    const onUpdate = () => updates++;
    bus.on('behavior:update', onUpdate);
    assert.equal(await svc.recordFrame(frame(0, { persons: 0, attentive: 0, phone: 0, headDown: 0, handUp: 0 })), null);
    bus.off('behavior:update', onUpdate);
    assert.equal(db.rows.size, 0);
    assert.equal(updates, 1);
  });

  it('counts head-down only when sustained for 30 s (class-level lower bound)', async () => {
    const svc = new BehaviorService({ db: fakeDb(), manager: {}, enqueue: async () => {}, intervalMs: 10_000 });
    svc.loops.set(1, { headDown: [], timer: null, roomId: 1, endsAt: new Date(Date.now() + 1e6) });
    const pcts = [];
    for (const [s, hd] of [[0, 3], [10, 4], [20, 2], [30, 5]]) {
      pcts.push((await svc.recordFrame(frame(s, { headDown: hd }))).headDownPct);
    }
    // the first 3 frames span < 30 s → 0; then min(30, 40, 20, 50) = 20 enters the average
    assert.deepEqual(pcts, [0, 0, 0, 5]);
  });

  it('skips a beat while the previous capture is still running', async () => {
    let captures = 0;
    let release;
    const manager = { captureFromRoom: () => (captures++, new Promise((r) => (release = r))) };
    const svc = new BehaviorService({ db: fakeDb(), manager, enqueue: async () => {}, intervalMs: 60_000 });
    await svc.start({ id: 5, roomId: 1, endsAt: new Date(Date.now() + 3600_000) });
    await svc.tick(5);
    assert.equal(captures, 1);
    release([]);
    svc.shutdown();
  });
});
