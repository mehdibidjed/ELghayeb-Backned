import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export function signToken(teacher) {
  return jwt.sign({ sub: teacher.id, role: teacher.role, name: teacher.name }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

export function verifyToken(token) {
  const payload = jwt.verify(token, env.JWT_SECRET);
  return { id: Number(payload.sub), role: payload.role, name: payload.name };
}

/** Requires a valid `Authorization: Bearer <jwt>` header. */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized('Missing bearer token'));
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

export const requireRole =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden());

export const requireAdmin = requireRole('ADMIN');
