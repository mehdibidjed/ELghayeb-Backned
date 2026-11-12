import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { bus } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { verifyToken } from '../middlewares/auth.js';
import { canAccessSession } from '../services/session.service.js';

const log = logger.child({ mod: 'teacher-gateway' });
const sessionRoom = (id) => `session:${id}`;

/**
 * Socket.IO gateway for the web platform.
 *
 * Client → server: 'session:join' (sessionId, ack), 'session:leave' (sessionId)
 * Server → client: attendance:progress | attendance:done | attendance:error | attendance:updated
 *                  behavior:update | behavior:status | device:status
 */
export function attachTeacherGateway(server) {
  const io = new Server(server, {
    cors: { origin: env.CORS_ORIGIN.split(','), credentials: true },
    destroyUpgrade: false, // /ws/device upgrades are handled by the device gateway
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token ?? socket.handshake.headers.authorization?.replace(/^Bearer /, '');
    try {
      socket.data.user = verifyToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('users');
    socket.on('session:join', async (sessionId, ack) => {
      try {
        const id = Number(sessionId);
        if (!(await canAccessSession(socket.data.user, id))) throw new Error('forbidden');
        await socket.join(sessionRoom(id));
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });
    socket.on('session:leave', (sessionId) => socket.leave(sessionRoom(Number(sessionId))));
  });

  const toSession = (event) => (payload) => io.to(sessionRoom(payload.sessionId)).emit(event, payload);
  for (const event of [
    'attendance:progress',
    'attendance:done',
    'attendance:error',
    'attendance:updated',
    'behavior:update',
    'behavior:status',
  ]) {
    bus.on(event, toSession(event));
  }
  bus.on('device:status', (payload) => io.to('users').emit('device:status', payload));

  log.info('Socket.IO gateway ready');
  return io;
}
