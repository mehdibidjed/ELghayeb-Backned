import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { driverManager } from '../services/driver-manager.instance.js';
import { idParam } from './schemas.js';

const router = Router();
const body = z.object({ name: z.string().trim().min(1).max(60), depthM: z.number().positive().max(50).optional() });

router.get('/', async (_req, res) => {
  const rooms = await prisma.room.findMany({ orderBy: { name: 'asc' }, include: { devices: { select: { id: true, name: true } } } });
  res.json(rooms.map((r) => ({ ...r, cameraOnline: Boolean(driverManager.getByRoom(r.id)) })));
});
router.post('/', requireAdmin, validate({ body }), async (req, res) => {
  res.status(201).json(await prisma.room.create({ data: req.valid.body }));
});
router.patch('/:id', requireAdmin, validate({ params: idParam, body: body.partial() }), async (req, res) => {
  res.json(await prisma.room.update({ where: { id: req.valid.params.id }, data: req.valid.body }));
});
router.delete('/:id', requireAdmin, validate({ params: idParam }), async (req, res) => {
  await prisma.room.delete({ where: { id: req.valid.params.id } });
  res.status(204).end();
});

export default router;
