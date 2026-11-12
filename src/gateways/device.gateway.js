import { WebSocketServer } from 'ws';
import { env } from '../config/env.js';
import { sha256 } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { PiZeroDriver } from '../drivers/pi-zero.driver.js';

const log = logger.child({ mod: 'device-gateway' });
export const DEVICE_WS_PATH = '/ws/device';

/** Token from `?token=`, `Authorization: Bearer` or `X-Device-Token`. */
function extractToken(req, url) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return req.headers['x-device-token'] ?? url.searchParams.get('token');
}

function reject(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * WebSocket gateway for the Raspberry Pi Zero cameras at /ws/device.
 * Authenticates the device token, then hands the socket to a PiZeroDriver
 * registered in the DriverManager.
 */
export function attachDeviceGateway(server, driverManager, { findDevice = defaultFindDevice } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: env.DEVICE_MAX_FRAME_BYTES + 1024 });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== DEVICE_WS_PATH) return; // Socket.IO handles its own path

    try {
      const token = extractToken(req, url);
      if (!token) return reject(socket, 401, 'Unauthorized');
      const device = await findDevice(sha256(token));
      if (!device) return reject(socket, 401, 'Unauthorized');
      if (!device.enabled) return reject(socket, 403, 'Forbidden');

      wss.handleUpgrade(req, socket, head, (ws) => {
        const driver = new PiZeroDriver(ws, device, {
          captureTimeoutMs: env.DEVICE_CAPTURE_TIMEOUT_MS,
          maxFrameBytes: env.DEVICE_MAX_FRAME_BYTES,
          logger: log,
        });
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress;
        driverManager.register(driver, { ip });
        log.info({ deviceId: device.id, roomId: device.roomId, ip }, 'device connected');
        driver.once('close', (reason) => log.info({ deviceId: device.id, reason }, 'device disconnected'));
        ws.send(JSON.stringify({ type: 'welcome', deviceId: device.id, roomId: device.roomId, serverTime: Date.now() }));
      });
    } catch (err) {
      log.error({ err }, 'device upgrade failed');
      reject(socket, 500, 'Internal Server Error');
    }
  });

  return wss;
}

function defaultFindDevice(tokenHash) {
  return prisma.device.findUnique({
    where: { tokenHash },
    select: { id: true, name: true, roomId: true, enabled: true },
  });
}
