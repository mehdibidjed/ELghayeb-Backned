import { forbidden, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export const sessionInclude = {
  group: { select: { id: true, name: true, level: true } },
  room: { select: { id: true, name: true } },
  teacher: { select: { id: true, name: true } },
};

export async function canAccessSession(user, sessionId) {
  if (!user) return false;
  const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { teacherId: true } });
  if (!s) return false;
  return user.role === 'ADMIN' || s.teacherId === user.id;
}

/** Load a session the user may act on (owner teacher or admin), or throw 404/403. */
export async function getSessionForUser(user, sessionId) {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, include: sessionInclude });
  if (!session) throw notFound('Session not found');
  if (user.role !== 'ADMIN' && session.teacherId !== user.id) throw forbidden('Not your session');
  return session;
}

/** Local-day bounds for `date` = 'today' | 'YYYY-MM-DD'. */
export function dayRange(date) {
  const base = !date || date === 'today' ? new Date() : new Date(`${date}T00:00:00`);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function listSessions(user, { date, teacherId, groupId, roomId }) {
  const where = {};
  if (date) {
    const { start, end } = dayRange(date);
    where.startsAt = { gte: start, lt: end };
  }
  if (user.role !== 'ADMIN') where.teacherId = user.id;
  else if (teacherId) where.teacherId = teacherId;
  if (groupId) where.groupId = groupId;
  if (roomId) where.roomId = roomId;
  return prisma.session.findMany({ where, include: sessionInclude, orderBy: { startsAt: 'asc' } });
}
