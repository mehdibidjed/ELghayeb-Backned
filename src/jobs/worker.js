// Standalone worker process: `npm run worker` (set RUN_WORKERS=false on the API).
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { createAttendanceWorker } from './attendance.worker.js';
import { createBehaviorWorker } from './behavior.worker.js';

const workers = [createAttendanceWorker(), createBehaviorWorker()];
logger.info('workers started (attendance, behavior)');

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
