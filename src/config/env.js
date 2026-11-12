import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // Device (Raspberry Pi Zero) gateway
  DEVICE_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().default(75_000),
  DEVICE_CAPTURE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DEVICE_MAX_FRAME_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  ATTENDANCE_SHOTS: z.coerce.number().int().min(1).max(5).default(3),
  // Servo pan angles for the G / C / D shots; ignored by a fixed camera.
  ATTENDANCE_PAN_ANGLES: z
    .string()
    .default('-40,0,40')
    .transform((s) => s.split(',').map((n) => Number(n.trim()))),
  ATTENDANCE_COUNTDOWN_S: z.coerce.number().int().min(0).max(10).default(3),

  BEHAVIOR_INTERVAL_MS: z.coerce.number().int().min(2000).default(10_000),

  // Run BullMQ workers inside the API process (simplest deployment).
  RUN_WORKERS: bool.default(true),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
