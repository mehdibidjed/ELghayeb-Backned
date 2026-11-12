import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';
import { correctAttendance } from '../services/attendance.service.js';
import { attendanceStatus, idParam } from './schemas.js';

const router = Router();

// PATCH /api/attendance/:id — teacher correction
router.patch('/:id', validate({ params: idParam, body: z.object({ status: attendanceStatus }) }), async (req, res) => {
  res.json(await correctAttendance(req.valid.params.id, req.valid.body.status, req.user));
});

export default router;
