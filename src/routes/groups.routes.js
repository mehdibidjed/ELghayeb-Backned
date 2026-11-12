import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { idParam } from './schemas.js';

const router = Router();
const body = z.object({ name: z.string().trim().min(1).max(60), level: z.string().trim().max(20).optional() });

router.get('/', async (_req, res) => {
  res.json(await prisma.group.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { students: true } } } }));
});
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(await prisma.group.findUniqueOrThrow({ where: { id: req.valid.params.id }, include: { students: true } }));
});
router.post('/', requireAdmin, validate({ body }), async (req, res) => {
  res.status(201).json(await prisma.group.create({ data: req.valid.body }));
});
router.patch('/:id', requireAdmin, validate({ params: idParam, body: body.partial() }), async (req, res) => {
  res.json(await prisma.group.update({ where: { id: req.valid.params.id }, data: req.valid.body }));
});
router.delete('/:id', requireAdmin, validate({ params: idParam }), async (req, res) => {
  await prisma.group.delete({ where: { id: req.valid.params.id } });
  res.status(204).end();
});

export default router;
