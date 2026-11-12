import { Router } from 'express';
import { z } from 'zod';
import { aiClient } from '../ai/ai.client.js';
import { DeviceError } from '../drivers/camera.driver.js';
import { badRequest, conflict, unavailable } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { listAttendance, setManualAttendance, triggerAttendance } from '../services/attendance.service.js';
import { behaviorService } from '../services/behavior.service.js';
import { driverManager } from '../services/driver-manager.instance.js';
import { getSessionForUser, listSessions, sessionInclude } from '../services/session.service.js';
import { attendanceStatus, idParam, optionalId } from './schemas.js';

const router = Router();

const listQuery = z.object({
  date: z.union([z.literal('today'), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  teacherId: optionalId,
  groupId: optionalId,
  roomId: optionalId,
});

const sessionFields = z.object({
  groupId: z.number().int().positive(),
  roomId: z.number().int().positive(),
  teacherId: z.number().int().positive(),
  subject: z.string().trim().max(120).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});
const sessionBody = sessionFields.refine((s) => s.endsAt > s.startsAt, {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});

const withDevice = (session) => {
  const driver = driverManager.getByRoom(session.roomId);
  return {
    ...session,
    device: driver ? { id: driver.deviceId, name: driver.name, online: true, info: driver.info } : { online: false },
    behaviorActive: behaviorService.isActive(session.id),
  };
};

// GET /api/sessions?date=today — the teacher's sessions (admin: all)
router.get('/', validate({ query: listQuery }), async (req, res) => {
  const sessions = await listSessions(req.user, req.valid.query);
  res.json(sessions.map(withDevice));
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(withDevice(await getSessionForUser(req.user, req.valid.params.id)));
});

router.post('/', requireAdmin, validate({ body: sessionBody }), async (req, res) => {
  const session = await prisma.session.create({ data: req.valid.body, include: sessionInclude });
  res.status(201).json(session);
});

router.patch(
  '/:id',
  requireAdmin,
  validate({ params: idParam, body: sessionFields.partial() }),
  async (req, res) => {
    const data = req.valid.body;
    if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) throw badRequest('endsAt must be after startsAt');
    res.json(await prisma.session.update({ where: { id: req.valid.params.id }, data, include: sessionInclude }));
  },
);

router.delete('/:id', requireAdmin, validate({ params: idParam }), async (req, res) => {
  await behaviorService.stop(req.valid.params.id, 'session deleted');
  await prisma.session.delete({ where: { id: req.valid.params.id } });
  res.status(204).end();
});

// POST /api/sessions/:id/attendance — "Lancer l'appel" (the trigger)
router.post('/:id/attendance', validate({ params: idParam }), async (req, res) => {
  const session = await getSessionForUser(req.user, req.valid.params.id);
  try {
    const run = await triggerAttendance(session);
    res.status(202).json({ runId: run.id, status: run.status, shots: run.shots });
  } catch (err) {
    if (err instanceof DeviceError) throw conflict(err.message, { code: err.code });
    throw err;
  }
});

router.get('/:id/attendance', validate({ params: idParam }), async (req, res) => {
  res.json(await listAttendance(await getSessionForUser(req.user, req.valid.params.id)));
});

// PUT /api/sessions/:id/attendance/:studentId — manual mark without an existing row
router.put(
  '/:id/attendance/:studentId',
  validate({
    params: idParam.extend({ studentId: z.coerce.number().int().positive() }),
    body: z.object({ status: attendanceStatus }),
  }),
  async (req, res) => {
    const session = await getSessionForUser(req.user, req.valid.params.id);
    res.json(await setManualAttendance(session, req.valid.params.studentId, req.valid.body.status));
  },
);

router.get('/:id/runs', validate({ params: idParam }), async (req, res) => {
  const session = await getSessionForUser(req.user, req.valid.params.id);
  res.json(await prisma.attendanceRun.findMany({ where: { sessionId: session.id }, orderBy: { id: 'desc' }, take: 20 }));
});

// POST /api/sessions/:id/behavior/start|stop — "Suivi du comportement"
router.post('/:id/behavior/start', validate({ params: idParam }), async (req, res) => {
  const session = await getSessionForUser(req.user, req.valid.params.id);
  if (session.endsAt < new Date()) throw conflict('Session has already ended');
  if (!driverManager.getByRoom(session.roomId)) throw conflict(`No online camera in room ${session.room.name}`);
  const health = await aiClient.health().catch(() => null);
  if (!health?.behavior) throw unavailable('Behaviour model is not available on the AI service', { health });
  res.json(await behaviorService.start(session));
});

router.post('/:id/behavior/stop', validate({ params: idParam }), async (req, res) => {
  const session = await getSessionForUser(req.user, req.valid.params.id);
  res.json(await behaviorService.stop(session.id, 'stopped by teacher'));
});

router.get('/:id/behavior', validate({ params: idParam }), async (req, res) => {
  const session = await getSessionForUser(req.user, req.valid.params.id);
  res.json({ sessionId: session.id, active: behaviorService.isActive(session.id), series: await behaviorService.series(session.id) });
});

export default router;
