import { Queue, QueueEvents } from 'bullmq';
import { createRedis } from '../lib/redis.js';

export const ATTENDANCE_QUEUE = 'attendance';
export const BEHAVIOR_QUEUE = 'behavior';

// Images live in the job only while it is processed: jobs are removed as soon
// as they finish, successfully or not ("images effacées après analyse").
const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: true,
};

let queues;

export function getQueues() {
  if (!queues) {
    const connection = createRedis();
    queues = {
      connection,
      attendance: new Queue(ATTENDANCE_QUEUE, {
        connection,
        defaultJobOptions: { ...defaultJobOptions, attempts: 2, backoff: { type: 'fixed', delay: 3000 } },
      }),
      behavior: new Queue(BEHAVIOR_QUEUE, {
        connection,
        // A behaviour frame is worthless 10 s later: no retry.
        defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
      }),
    };
  }
  return queues;
}

export function createQueueEvents(name) {
  return new QueueEvents(name, { connection: createRedis() });
}

export const encodeImage = (frame) => ({
  b64: frame.buffer.toString('base64'),
  position: frame.position ?? null,
  seq: frame.seq,
});
export const decodeImage = (img) => ({ buffer: Buffer.from(img.b64, 'base64'), position: img.position ?? null });

/** One "appel" = one job with the 3 photos of the scan (they are matched together for dedup). */
export function enqueueAttendance({ runId, sessionId, frames }) {
  return getQueues().attendance.add(
    'recognize',
    { runId, sessionId, images: frames.map(encodeImage) },
    { jobId: `run-${runId}` },
  );
}

/** One behaviour frame = one job. */
export function enqueueBehavior({ sessionId, frame }) {
  return getQueues().behavior.add('analyze', {
    sessionId,
    capturedAt: frame.capturedAt.toISOString(),
    image: encodeImage(frame),
  });
}

export async function closeQueues() {
  if (!queues) return;
  await Promise.all([queues.attendance.close(), queues.behavior.close()]);
  queues.connection.disconnect();
  queues = undefined;
}
