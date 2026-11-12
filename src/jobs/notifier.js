import { bus } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { behaviorService } from '../services/behavior.service.js';
import { ATTENDANCE_QUEUE, BEHAVIOR_QUEUE, createQueueEvents } from './queue.js';

const log = logger.child({ mod: 'notifier' });
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const runIdOf = (jobId) => Number(String(jobId).replace(/^run-/, ''));

/**
 * Bridges BullMQ job events to the in-process bus (→ Socket.IO). Works whether
 * the workers run in this process or in a separate `npm run worker`.
 */
export function startNotifier() {
  const attendanceEvents = createQueueEvents(ATTENDANCE_QUEUE);
  const behaviorEvents = createQueueEvents(BEHAVIOR_QUEUE);

  attendanceEvents.on('progress', async ({ jobId, data }) => {
    const run = await prisma.attendanceRun.findUnique({ where: { id: runIdOf(jobId) } });
    if (run) bus.emit('attendance:progress', { sessionId: run.sessionId, runId: run.id, ...parse(data) });
  });

  attendanceEvents.on('completed', ({ returnvalue }) => {
    const result = parse(returnvalue);
    bus.emit('attendance:done', result);
  });

  attendanceEvents.on('failed', async ({ jobId, failedReason }) => {
    const run = await prisma.attendanceRun.findUnique({ where: { id: runIdOf(jobId) } });
    // Only report the final failure (the worker marks the run FAILED on the last attempt).
    if (run?.status === 'FAILED') {
      bus.emit('attendance:error', { sessionId: run.sessionId, runId: run.id, error: failedReason });
    }
  });

  behaviorEvents.on('completed', ({ returnvalue }) => {
    behaviorService.recordFrame(parse(returnvalue)).catch((err) => log.error({ err }, 'failed to record behaviour frame'));
  });

  behaviorEvents.on('failed', async ({ jobId, failedReason }) => {
    if (!failedReason?.startsWith('behavior_unavailable')) return;
    // Models missing on the AI side: stop every loop instead of failing every 10 s.
    log.warn({ jobId, failedReason }, 'behaviour model unavailable, stopping loops');
    for (const sessionId of [...behaviorService.loops.keys()]) {
      await behaviorService.stop(sessionId, 'behaviour model unavailable');
    }
  });

  return {
    async close() {
      await Promise.all([attendanceEvents.close(), behaviorEvents.close()]);
    },
  };
}
