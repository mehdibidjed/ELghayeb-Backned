import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { enrollFaces } from '../services/student.service.js';
import { idParam, optionalId } from './schemas.js';

const router = Router();
// Photos stay in memory: only the embeddings are kept.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) =>
    ['image/jpeg', 'image/png'].includes(file.mimetype) ? cb(null, true) : cb(badRequest('Only JPEG or PNG photos')),
});

const studentBody = z.object({
  matricule: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  groupId: z.number().int().positive(),
});

const select = {
  id: true,
  matricule: true,
  name: true,
  groupId: true,
  group: { select: { id: true, name: true } },
  _count: { select: { embeddings: true } },
};
const shape = ({ _count, ...s }) => ({ ...s, faces: _count.embeddings, enrolled: _count.embeddings > 0 });

router.get('/', validate({ query: z.object({ groupId: optionalId, q: z.string().optional() }) }), async (req, res) => {
  const { groupId, q } = req.valid.query;
  const students = await prisma.student.findMany({
    where: {
      ...(groupId ? { groupId } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { matricule: { contains: q } }] } : {}),
    },
    select,
    orderBy: { name: 'asc' },
  });
  res.json(students.map(shape));
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json(shape(await prisma.student.findUniqueOrThrow({ where: { id: req.valid.params.id }, select })));
});

router.post('/', requireAdmin, validate({ body: studentBody }), async (req, res) => {
  res.status(201).json(shape(await prisma.student.create({ data: req.valid.body, select })));
});

router.patch('/:id', requireAdmin, validate({ params: idParam, body: studentBody.partial() }), async (req, res) => {
  res.json(shape(await prisma.student.update({ where: { id: req.valid.params.id }, data: req.valid.body, select })));
});

router.delete('/:id', requireAdmin, validate({ params: idParam }), async (req, res) => {
  await prisma.student.delete({ where: { id: req.valid.params.id } });
  res.status(204).end();
});

// POST /api/students/:id/faces — enrolment, multipart field "photos" (up to 5). ?replace=true drops old ones.
router.post(
  '/:id/faces',
  requireAdmin,
  upload.array('photos', 5),
  validate({ params: idParam, query: z.object({ replace: z.enum(['true', 'false']).optional() }) }),
  async (req, res) => {
    const result = await enrollFaces(req.valid.params.id, req.files, { replace: req.valid.query.replace === 'true' });
    res.status(result.accepted ? 201 : 422).json(result);
  },
);

router.get('/:id/faces', validate({ params: idParam }), async (req, res) => {
  const faces = await prisma.faceEmbedding.findMany({
    where: { studentId: req.valid.params.id },
    select: { id: true, detScore: true, createdAt: true }, // never expose the vectors
  });
  res.json(faces);
});

router.delete('/:id/faces', requireAdmin, validate({ params: idParam }), async (req, res) => {
  const { count } = await prisma.faceEmbedding.deleteMany({ where: { studentId: req.valid.params.id } });
  res.json({ deleted: count });
});

export default router;
