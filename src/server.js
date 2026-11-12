import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { attachDeviceGateway } from './gateways/device.gateway.js';
import { attachTeacherGateway } from './gateways/teacher.gateway.js';
import { createAttendanceWorker } from './jobs/attendance.worker.js';
import { createBehaviorWorker } from './jobs/behavior.worker.js';
import { startNotifier } from './jobs/notifier.js';
import { closeQueues } from './jobs/queue.js';
import { bus } from './lib/events.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { failInterruptedRuns } from './services/attendance.service.js';
import { behaviorService } from './services/behavior.service.js';
import { driverManager } from './services/driver-manager.instance.js';

const app = createApp();
const server = http.createServer(app);

// Realtime: Pi Zero cameras on /ws/device, web platform on Socket.IO.
attachDeviceGateway(server, driverManager);
const io = attachTeacherGateway(server);

driverManager.on('online', (d) => bus.emit('device:status', { deviceId: d.deviceId, roomId: d.roomId, online: true, info: d.info }));
driverManager.on('info', (d) => bus.emit('device:status', { deviceId: d.deviceId, roomId: d.roomId, online: d.online, info: d.info }));
driverManager.on('offline', ({ deviceId, roomId, reason }) =>
  bus.emit('device:status', { deviceId, roomId, online: false, reason }),
);
driverManager.start();

const workers = env.RUN_WORKERS ? [createAttendanceWorker(), createBehaviorWorker()] : [];
const notifier = startNotifier();

await failInterruptedRuns();
await behaviorService.resume();

server.listen(env.PORT, () => {
  logger.info(`El Ghayeb backend on :${env.PORT} (devices: ws://…/ws/device, workers: ${env.RUN_WORKERS ? 'in-process' : 'external'})`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down');
  behaviorService.shutdown();
  driverManager.stop();
  io.close();
  server.close();
  await Promise.allSettled([...workers.map((w) => w.close()), notifier.close(), closeQueues()]);
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
