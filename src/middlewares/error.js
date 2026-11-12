import multer from 'multer';
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Already exists', fields: err.meta?.target });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'P2003') return res.status(409).json({ error: 'Linked record constraint failed' });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });

  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}
