import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, signToken } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

const loginBody = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(1) });

router.post('/login', loginLimiter, validate({ body: loginBody }), async (req, res) => {
  const { email, password } = req.valid.body;
  const teacher = await prisma.teacher.findUnique({ where: { email } });
  if (!teacher || !(await bcrypt.compare(password, teacher.passwordHash))) throw unauthorized('Invalid email or password');
  res.json({
    token: signToken(teacher),
    user: { id: teacher.id, name: teacher.name, email: teacher.email, role: teacher.role },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const me = await prisma.teacher.findUniqueOrThrow({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true },
  });
  res.json(me);
});

export default router;
