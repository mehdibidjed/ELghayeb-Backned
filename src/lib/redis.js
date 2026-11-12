import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/** New connection suitable for BullMQ (it requires maxRetriesPerRequest: null). */
export function createRedis() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
