import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { idParam } from './schemas.js';

const router = Router();
router.use(requireAdmin);

const select = { id: true, name: true, email: true, role: true, createdAt: true };
const body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(128),
  role: z.enum(['ADMIN', 'TEACHER']).optional(), // defaults to TEACHER in the DB
});

const toData = async ({ password, ...rest }) => ({
  ...rest,
  ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
});

router.get('/', async (_req, res) => res.json(await prisma.teacher.findMany({ select, orderBy: { name: 'asc' } })));
router.post('/', validate({ body }), async (req, res) => {
  res.status(201).json(await prisma.teacher.create({ data: await toData(req.valid.body), select }));
});
router.patch('/:id', validate({ params: idParam, body: body.partial() }), async (req, res) => {
  res.json(await prisma.teacher.update({ where: { id: req.valid.params.id }, data: await toData(req.valid.body), select }));
});
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await prisma.teacher.delete({ where: { id: req.valid.params.id } });
  res.status(204).end();
});

export default router;
