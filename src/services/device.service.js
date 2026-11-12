import { newDeviceToken, sha256 } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { driverManager } from './driver-manager.instance.js';

const publicSelect = {
  id: true,
  name: true,
  roomId: true,
  enabled: true,
  lastSeen: true,
  lastIp: true,
  info: true,
  createdAt: true,
  room: { select: { id: true, name: true } },
};

const withLive = (d, manager) => {
  const live = manager.drivers.get(d.id);
  return { ...d, online: Boolean(live?.online), busy: live?.busy ?? false, connectedAt: live?.connectedAt ?? null };
};

export async function listDevices(manager = driverManager) {
  const devices = await prisma.device.findMany({ select: publicSelect, orderBy: { id: 'asc' } });
  return devices.map((d) => withLive(d, manager));
}

export async function getDevice(id, manager = driverManager) {
  const d = await prisma.device.findUnique({ where: { id }, select: publicSelect });
  if (!d) throw notFound('Device not found');
  return withLive(d, manager);
}

/** Returns the plain token once — it is not retrievable afterwards. */
export async function createDevice({ name, roomId }) {
  const token = newDeviceToken();
  const device = await prisma.device.create({
    data: { name, roomId: roomId ?? null, tokenHash: sha256(token) },
    select: publicSelect,
  });
  return { device, token };
}

export async function updateDevice(id, data, manager = driverManager) {
  const device = await prisma.device.update({ where: { id }, data, select: publicSelect });
  manager.updateDevice(id, { roomId: device.roomId, name: device.name });
  if (data.enabled === false) manager.disconnect(id, 'device disabled');
  return withLive(device, manager);
}

export async function rotateToken(id, manager = driverManager) {
  const token = newDeviceToken();
  await prisma.device.update({ where: { id }, data: { tokenHash: sha256(token) } });
  manager.disconnect(id, 'token rotated');
  return { id, token };
}

export async function deleteDevice(id, manager = driverManager) {
  manager.disconnect(id, 'device deleted');
  await prisma.device.delete({ where: { id } });
}
