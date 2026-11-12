import { Worker } from 'bullmq';
import { aiClient } from '../ai/ai.client.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { createRedis } from '../lib/redis.js';
import { ATTENDANCE_QUEUE, decodeImage } from './queue.js';

const log = logger.child({ mod: 'attendance-worker' });

const STATUS_FROM_AI = { present: 'PRESENT', needs_review: 'REVIEW', absent: 'ABSENT' };
const RANK = { ABSENT: 0, REVIEW: 1, PRESENT: 2 };

/**
 * Model 1 job: recognise the group's students in the scan photos and write the
 * attendance rows.
 *
 * Merge rules when the call is run several times in the same session:
 *  - a MANUAL correction by the teacher is never overwritten;
 *  - an AI row only moves up (ABSENT → REVIEW → PRESENT): a student seen once is present.
 */
export async function processAttendanceJob(job, { ai = aiClient, db = prisma } = {}) {
  const { runId, sessionId } = job.data;
  await db.attendanceRun.update({ where: { id: runId }, data: { status: 'PROCESSING' } });
  await job.updateProgress({ stage: 'processing' });

  const session = await db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { groupId: true } });
  const students = await db.student.findMany({
    where: { groupId: session.groupId },
    select: { id: true, name: true, matricule: true, embeddings: { select: { vector: true } } },
  });

  const enrolled = students.filter((s) => s.embeddings.length > 0);
  const images = job.data.images.map(decodeImage);
  const result = await ai.recognize(
    images,
    enrolled.map((s) => ({ id: s.id, embeddings: s.embeddings.map((e) => e.vector) })),
  );
  const byId = new Map(result.students.map((r) => [Number(r.id), r]));

  const existing = await db.attendance.findMany({ where: { sessionId } });
  const existingByStudent = new Map(existing.map((a) => [a.studentId, a]));

  const writes = [];
  for (const s of students) {
    const ai = byId.get(s.id);
    // Not enrolled → the model cannot see them: ask the teacher instead of marking absent.
    const status = s.embeddings.length === 0 ? 'REVIEW' : (STATUS_FROM_AI[ai?.status] ?? 'ABSENT');
    const confidence = ai?.similarity ?? null;
    const prev = existingByStudent.get(s.id);

    if (prev?.source === 'MANUAL') continue;
    if (prev && RANK[prev.status] > RANK[status]) continue;
    if (prev && RANK[prev.status] === RANK[status] && (prev.confidence ?? -1) >= (confidence ?? -1)) continue;

    writes.push(
      db.attendance.upsert({
        where: { sessionId_studentId: { sessionId, studentId: s.id } },
        create: { sessionId, studentId: s.id, status, confidence, source: 'AI' },
        update: { status, confidence, source: 'AI' },
      }),
    );
  }
  await db.$transaction(writes);

  await db.attendanceRun.update({
    where: { id: runId },
    data: { status: 'DONE', facesFound: result.faces_total ?? null, finishedAt: new Date() },
  });

  const records = await db.attendance.findMany({ where: { sessionId }, select: { status: true } });
  const summary = { present: 0, absent: 0, review: 0 };
  for (const r of records) summary[r.status.toLowerCase()]++;

  return {
    runId,
    sessionId,
    summary,
    facesFound: result.faces_total ?? null,
    unknownFaces: result.unknown_faces ?? null,
    notEnrolled: students.length - enrolled.length,
  };
}

export async function markRunFailed(runId, error, db = prisma) {
  await db.attendanceRun
    .update({ where: { id: runId }, data: { status: 'FAILED', error: String(error).slice(0, 500), finishedAt: new Date() } })
    .catch(() => {});
}

export function createAttendanceWorker() {
  const worker = new Worker(
    ATTENDANCE_QUEUE,
    async (job) => {
      try {
        return await processAttendanceJob(job);
      } catch (err) {
        const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (lastAttempt) await markRunFailed(job.data.runId, err.message);
        throw err;
      }
    },
    { connection: createRedis(), concurrency: 1 }, // CPU-bound model on the AI side: one call at a time
  );
  worker.on('failed', (job, err) => log.error({ err, jobId: job?.id }, 'attendance job failed'));
  return worker;
}

