import { z } from 'zod';

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const optionalId = z.coerce.number().int().positive().optional();
export const attendanceStatus = z.enum(['PRESENT', 'ABSENT', 'REVIEW']);
