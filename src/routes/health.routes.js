import { Router } from 'express';
import { aiClient } from '../ai/ai.client.js';
import { prisma } from '../lib/prisma.js';
import { getQueues } from '../jobs/queue.js';
import { driverManager } from '../services/driver-manager.instance.js';

const router = Router();

const check = async (fn) => {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

router.get('/', async (_req, res) => {
  const [db, redis, ai] = await Promise.all([
    check(() => prisma.$queryRaw`SELECT 1`.then(() => ({}))),
    check(() => getQueues().connection.ping().then(() => ({}))),
    check(() => aiClient.health()),
  ]);
  const ok = db.ok && redis.ok;
  res.status(ok ? 200 : 503).json({
    status: ok ? (ai.ok ? 'ok' : 'degraded') : 'down',
    db,
    redis,
    ai,
    devicesOnline: driverManager.list().filter((d) => d.online).length,
  });
});

export default router;
