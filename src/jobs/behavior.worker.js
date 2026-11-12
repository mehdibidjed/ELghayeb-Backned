import { UnrecoverableError, Worker } from 'bullmq';
import { aiClient } from '../ai/ai.client.js';
import { logger } from '../lib/logger.js';
import { createRedis } from '../lib/redis.js';
import { BEHAVIOR_QUEUE, decodeImage } from './queue.js';

const log = logger.child({ mod: 'behavior-worker' });

/**
 * Model 2 job: one photo → class-level counts. Nothing about individuals is
 * returned or stored. Aggregation per minute is done by BehaviorService.
 */
export async function processBehaviorJob(job, { ai = aiClient } = {}) {
  const { sessionId, capturedAt } = job.data;
  try {
    const r = await ai.analyzeBehavior(decodeImage(job.data.image).buffer);
    return {
      sessionId,
      capturedAt,
      persons: r.persons ?? 0,
      attentive: r.attentive ?? 0,
      phone: r.phone ?? 0,
      headDown: r.head_down ?? 0,
      handUp: r.hand_up ?? 0,
    };
  } catch (err) {
    // 503 from the AI service = behaviour models not installed: retrying won't help.
    if (err.status === 503) throw new UnrecoverableError(`behavior_unavailable: ${err.message}`);
    throw err;
  }
}

export function createBehaviorWorker() {
  const worker = new Worker(BEHAVIOR_QUEUE, processBehaviorJob, { connection: createRedis(), concurrency: 2 });
  worker.on('failed', (job, err) => log.warn({ err: err.message, jobId: job?.id }, 'behavior job failed'));
  return worker;
}
