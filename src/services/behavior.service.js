import { env } from '../config/env.js';
import { bus } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { enqueueBehavior } from '../jobs/queue.js';
import { driverManager } from './driver-manager.instance.js';

const log = logger.child({ mod: 'behavior' });

// "tête baissée > 30 s": without tracking individuals we use a class-level
// lower bound — the smallest head-down share over the last 30 s of frames.
const HEAD_DOWN_WINDOW_MS = 30_000;

export const truncateToMinute = (d) => {
  const m = new Date(d);
  m.setSeconds(0, 0);
  return m;
};

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

/**
 * Behaviour tracking ("Suivi du comportement"): while active, asks the room's
 * camera for one photo every BEHAVIOR_INTERVAL_MS, queues it for model 2, and
 * aggregates the class-level percentages per minute in behavior_stats.
 */
export class BehaviorService {
  constructor({ manager = driverManager, enqueue = enqueueBehavior, db = prisma, intervalMs = env.BEHAVIOR_INTERVAL_MS } = {}) {
    this.manager = manager;
    this.enqueue = enqueue;
    this.db = db;
    this.intervalMs = intervalMs;
    /** @type {Map<number, { timer, roomId, endsAt: Date, ticking: boolean, headDown: Array<{t:number,pct:number}> }>} */
    this.loops = new Map();
  }

  isActive(sessionId) {
    return this.loops.has(sessionId);
  }

  async start(session) {
    if (this.loops.has(session.id)) return { active: true, alreadyRunning: true };
    await this.db.session.update({ where: { id: session.id }, data: { behaviorActive: true } });
    this.#startLoop(session);
    bus.emit('behavior:status', { sessionId: session.id, active: true });
    return { active: true };
  }

  async stop(sessionId, reason = 'stopped') {
    const loop = this.loops.get(sessionId);
    if (loop) clearInterval(loop.timer);
    this.loops.delete(sessionId);
    await this.db.session.update({ where: { id: sessionId }, data: { behaviorActive: false } }).catch(() => {});
    bus.emit('behavior:status', { sessionId, active: false, reason });
    return { active: false };
  }

  /** On boot: resume loops of sessions still running, close the others. */
  async resume() {
    const sessions = await this.db.session.findMany({ where: { behaviorActive: true } });
    for (const s of sessions) {
      if (s.endsAt > new Date()) this.#startLoop(s);
      else await this.stop(s.id, 'session ended');
    }
    if (sessions.length) log.info({ count: this.loops.size }, 'resumed behaviour loops');
  }

  shutdown() {
    for (const loop of this.loops.values()) clearInterval(loop.timer);
    this.loops.clear();
  }

  #startLoop(session) {
    const loop = { roomId: session.roomId, endsAt: new Date(session.endsAt), ticking: false, headDown: [], timer: null };
    loop.timer = setInterval(() => this.tick(session.id), this.intervalMs);
    loop.timer.unref?.();
    this.loops.set(session.id, loop);
    this.tick(session.id);
  }

  async tick(sessionId) {
    const loop = this.loops.get(sessionId);
    if (!loop || loop.ticking) return; // previous capture still running: skip this beat
    if (new Date() > loop.endsAt) return this.stop(sessionId, 'session ended');

    loop.ticking = true;
    try {
      const [frame] = await this.manager.captureFromRoom(loop.roomId, { mode: 'behavior', shots: 1 });
      if (frame) await this.enqueue({ sessionId, frame });
    } catch (err) {
      // Camera offline / busy: keep the loop, the device may come back.
      bus.emit('behavior:status', { sessionId, active: true, warning: err.message, code: err.code });
    } finally {
      loop.ticking = false;
    }
  }

  /** Called with the result of a behaviour job (one analysed frame). */
  async recordFrame(frame) {
    const { sessionId } = frame;
    const capturedAt = new Date(frame.capturedAt);
    const persons = frame.persons ?? 0;

    const instant = {
      persons,
      attentivePct: pct(frame.attentive, persons),
      phonePct: pct(frame.phone, persons),
      headDownPct: pct(frame.headDown, persons),
      handUpPct: pct(frame.handUp, persons),
    };

    const loop = this.loops.get(sessionId);
    let sustainedHeadDown = 0;
    if (loop) {
      const t = capturedAt.getTime();
      loop.headDown.push({ t, pct: instant.headDownPct });
      loop.headDown = loop.headDown.filter((h) => t - h.t <= HEAD_DOWN_WINDOW_MS + this.intervalMs);
      const spanMs = t - loop.headDown[0].t;
      if (spanMs >= HEAD_DOWN_WINDOW_MS) sustainedHeadDown = Math.min(...loop.headDown.map((h) => h.pct));
    }

    if (persons === 0) {
      // Empty frame (nobody detected): don't drag the class averages to 0.
      bus.emit('behavior:update', { sessionId, frame: instant, stats: null });
      return null;
    }

    const minute = truncateToMinute(capturedAt);
    const values = { ...instant, headDownPct: sustainedHeadDown };
    const where = { sessionId_minute: { sessionId, minute } };
    const prev = await this.db.behaviorStat.findUnique({ where });
    const n = prev?.samples ?? 0;
    const avg = (key) => Math.round((((prev?.[key] ?? 0) * n + values[key]) / (n + 1)) * 10) / 10;
    const data = {
      samples: n + 1,
      persons: avg('persons'),
      attentivePct: avg('attentivePct'),
      phonePct: avg('phonePct'),
      headDownPct: avg('headDownPct'),
      handUpPct: avg('handUpPct'),
    };
    const stats = await this.db.behaviorStat.upsert({ where, create: { sessionId, minute, ...data }, update: data });

    bus.emit('behavior:update', { sessionId, minute, frame: instant, stats });
    return stats;
  }

  series(sessionId) {
    return this.db.behaviorStat.findMany({ where: { sessionId }, orderBy: { minute: 'asc' } });
  }
}

export const behaviorService = new BehaviorService();
