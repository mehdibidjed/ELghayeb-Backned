import { aiClient } from '../ai/ai.client.js';
import { badRequest, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export const MAX_FACES_PER_STUDENT = 10;

/**
 * Enrol face photos for a student (spec: 5 photos). Each photo must contain
 * exactly one face; its ArcFace embedding is stored, the photo is discarded.
 */
export async function enrollFaces(studentId, files, { replace = false, ai = aiClient } = {}) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { _count: { select: { embeddings: true } } },
  });
  if (!student) throw notFound('Student not found');
  if (!files?.length) throw badRequest('Send at least one photo in the "photos" field');

  const existing = replace ? 0 : student._count.embeddings;
  if (existing + files.length > MAX_FACES_PER_STUDENT) {
    throw badRequest(`A student can have at most ${MAX_FACES_PER_STUDENT} face photos (has ${existing})`);
  }

  const results = [];
  const accepted = [];
  for (const file of files) {
    const { faces } = await ai.embedFace(file.buffer, file.originalname);
    if (faces.length !== 1) {
      results.push({ file: file.originalname, accepted: false, reason: `found ${faces.length} faces, expected 1` });
      continue;
    }
    accepted.push({ studentId, vector: faces[0].embedding, detScore: faces[0].det_score });
    results.push({ file: file.originalname, accepted: true, detScore: faces[0].det_score });
  }

  if (accepted.length) {
    await prisma.$transaction([
      ...(replace ? [prisma.faceEmbedding.deleteMany({ where: { studentId } })] : []),
      prisma.faceEmbedding.createMany({ data: accepted }),
    ]);
  }
  const total = await prisma.faceEmbedding.count({ where: { studentId } });
  return { studentId, accepted: accepted.length, rejected: files.length - accepted.length, total, results };
}
