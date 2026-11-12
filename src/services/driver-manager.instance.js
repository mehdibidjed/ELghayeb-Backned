import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { DriverManager } from './driver-manager.service.js';

/** The process-wide DriverManager, persisting device status to PostgreSQL. */
export const driverManager = new DriverManager({
  heartbeatTimeoutMs: env.DEVICE_HEARTBEAT_TIMEOUT_MS,
  logger: logger.child({ mod: 'drivers' }),
  store: {
    async touch(deviceId, { lastSeen, info, ip }) {
      await prisma.device.update({
        where: { id: deviceId },
        data: { lastSeen, info: info ?? undefined, ...(ip ? { lastIp: ip } : {}) },
      });
    },
  },
});
