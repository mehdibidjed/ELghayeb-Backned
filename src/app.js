import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { requireAuth } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import attendanceRoutes from './routes/attendance.routes.js';
import authRoutes from './routes/auth.routes.js';
import devicesRoutes from './routes/devices.routes.js';
import groupsRoutes from './routes/groups.routes.js';
import healthRoutes from './routes/health.routes.js';
import roomsRoutes from './routes/rooms.routes.js';
import sessionsRoutes from './routes/sessions.routes.js';
import studentsRoutes from './routes/students.routes.js';
import teachersRoutes from './routes/teachers.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/sessions', requireAuth, sessionsRoutes);
  app.use('/api/attendance', requireAuth, attendanceRoutes);
  app.use('/api/students', requireAuth, studentsRoutes);
  app.use('/api/groups', requireAuth, groupsRoutes);
  app.use('/api/rooms', requireAuth, roomsRoutes);
  app.use('/api/devices', requireAuth, devicesRoutes);
  app.use('/api/teachers', requireAuth, teachersRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
