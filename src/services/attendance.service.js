import { env } from '../config/env.js';
import { DeviceError } from '../drivers/camera.driver.js';
import { conflict, notFound } from '../lib/errors.js';
import { bus } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { enqueueAttendance } from '../jobs/queue.js';
import { driverManager } from './driver-manager.instance.js';

const log = logger.child({ mod: 'attendance' });
const ACTIVE = ['CAPTURING', 'QUEUED', 'PROCESSING'];
const STALE_MS = 5 * 60_000;

/**
 * "Lancer l'appel": create a run, then (in the background) ask the room's
 * camera for the G·C·D scan and queue the 3 photos for model 1.
 * Progress is pushed over Socket.IO; the HTTP call returns 202 immediately.
 */
export async function triggerAttendance(session, { manager = driverManager, enqueue = enqueueAttendance } = {}) {
  const running = await prisma.attendanceRun.findFirst({
    where: { sessionId: session.id, status: { in: ACTIVE }, requestedAt: { gt: new Date(Date.now() - STALE_MS) } },
  });
  if (running) throw conflict('An attendance call is already running for this session', { runId: running.id });

  const driver = manager.getByRoom(session.roomId);
  if (!driver) throw new DeviceError('DEVICE_OFFLINE', `No online camera in room ${session.room?.name ?? session.roomId}`);

  const shots = env.ATTENDANCE_SHOTS;
  const run = await prisma.attendanceRun.create({ data: { sessionId: session.id, shots } });
  const emit = (stage, extra = {}) =>
    bus.emit('attendance:progress', { sessionId: session.id, runId: run.id, stage, ...extra });

  (async () => {
    try {
      emit('capturing', { deviceId: driver.deviceId, shots });
      const frames = await driver.capture({
        mode: 'attendance',
        shots,
        pan: env.ATTENDANCE_PAN_ANGLES,
        countdown: env.ATTENDANCE_COUNTDOWN_S,
      });
      await enqueue({ runId: run.id, sessionId: session.id, frames });
      await prisma.attendanceRun.update({ where: { id: run.id }, data: { status: 'QUEUED' } });
      emit('queued', { frames: frames.length });
    } catch (err) {
      log.warn({ err: err.message, runId: run.id }, 'attendance capture failed');
      await prisma.attendanceRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: err.message.slice(0, 500), finishedAt: new Date() },
      });
      bus.emit('attendance:error', { sessionId: session.id, runId: run.id, error: err.message, code: err.code });
    }
  })();

  return run;
}

/** All students of the session's group with their attendance (null when no call yet). */
export async function listAttendance(session) {
  const students = await prisma.student.findMany({
    where: { groupId: session.groupId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      matricule: true,
      _count: { select: { embeddings: true } },
      attendance: { where: { sessionId: session.id } },
    },
  });
  const rows = students.map((s) => ({
    student: { id: s.id, name: s.name, matricule: s.matricule, enrolled: s._count.embeddings > 0 },
    attendance: s.attendance[0] ?? null,
  }));
  const summary = { present: 0, absent: 0, review: 0, unmarked: 0 };
  for (const r of rows) summary[r.attendance ? r.attendance.status.toLowerCase() : 'unmarked']++;
  const lastRun = await prisma.attendanceRun.findFirst({ where: { sessionId: session.id }, orderBy: { id: 'desc' } });
  return { sessionId: session.id, summary, lastRun, rows };
}

/** Teacher correction of one row ("corriger"). */
export async function correctAttendance(id, status, user) {
  const row = await prisma.attendance.findUnique({ where: { id }, include: { session: true } });
  if (!row) throw notFound('Attendance record not found');
  if (user.role !== 'ADMIN' && row.session.teacherId !== user.id) throw notFound('Attendance record not found');
  const updated = await prisma.attendance.update({ where: { id }, data: { status, source: 'MANUAL' } });
  bus.emit('attendance:updated', { sessionId: row.sessionId, record: updated });
  return updated;
}

/** Manual mark for a student who has no row yet (e.g. camera offline). */
export async function setManualAttendance(session, studentId, status) {
  const student = await prisma.student.findFirst({ where: { id: studentId, groupId: session.groupId } });
  if (!student) throw notFound('Student is not in this session group');
  const record = await prisma.attendance.upsert({
    where: { sessionId_studentId: { sessionId: session.id, studentId } },
    create: { sessionId: session.id, studentId, status, source: 'MANUAL' },
    update: { status, source: 'MANUAL' },
  });
  bus.emit('attendance:updated', { sessionId: session.id, record });
  return record;
}

/** On boot: captures that were in flight when the process stopped can't finish. */
export async function failInterruptedRuns() {
  const { count } = await prisma.attendanceRun.updateMany({
    where: { status: 'CAPTURING' },
    data: { status: 'FAILED', error: 'Interrupted by server restart', finishedAt: new Date() },
  });
  if (count) log.info({ count }, 'marked interrupted attendance runs as failed');
}
