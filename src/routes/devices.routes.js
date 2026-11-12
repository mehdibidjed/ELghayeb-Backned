import { Router } from 'express';
import { z } from 'zod';
import { DeviceError } from '../drivers/camera.driver.js';
import { conflict } from '../lib/errors.js';
import { requireAdmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { driverManager } from '../services/driver-manager.instance.js';
import { createDevice, deleteDevice, getDevice, listDevices, rotateToken, updateDevice } from '../services/device.service.js';
import { idParam } from './schemas.js';

const router = Router();
router.use(requireAdmin);

const body = z.object({
  name: z.string().trim().min(1).max(60),
  roomId: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional(),
});

router.get('/', async (_req, res) => res.json(await listDevices()));
router.get('/:id', validate({ params: idParam }), async (req, res) => res.json(await getDevice(req.valid.params.id)));

// Returns { device, token } — the token is shown only here; put it in the Pi's config.
router.post('/', validate({ body: body.omit({ enabled: true }) }), async (req, res) => {
  res.status(201).json(await createDevice(req.valid.body));
});

router.patch('/:id', validate({ params: idParam, body: body.partial() }), async (req, res) => {
  res.json(await updateDevice(req.valid.params.id, req.valid.body));
});

router.post('/:id/token', validate({ params: idParam }), async (req, res) => {
  res.json(await rotateToken(req.valid.params.id));
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await deleteDevice(req.valid.params.id);
  res.status(204).end();
});

// POST /api/devices/:id/test-capture — one photo straight back as JPEG (camera aiming). Not stored.
router.post(
  '/:id/test-capture',
  validate({ params: idParam, query: z.object({ pan: z.coerce.number().min(-90).max(90).optional() }) }),
  async (req, res) => {
    const pan = req.valid.query.pan;
    try {
      const [frame] = await driverManager.captureFromDevice(req.valid.params.id, {
        mode: 'test',
        shots: 1,
        pan: pan === undefined ? undefined : [pan],
      });
      res.type('image/jpeg').set('Cache-Control', 'no-store').send(frame.buffer);
    } catch (err) {
      if (err instanceof DeviceError) throw conflict(err.message, { code: err.code });
      throw err;
    }
  },
);

export default router;
