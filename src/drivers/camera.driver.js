import { EventEmitter } from 'node:events';

export class DeviceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const DeviceErrorCode = Object.freeze({
  OFFLINE: 'DEVICE_OFFLINE',
  TIMEOUT: 'CAPTURE_TIMEOUT',
  REMOTE: 'DEVICE_ERROR',
  BAD_FRAME: 'BAD_FRAME',
  CLOSED: 'CONNECTION_CLOSED',
});

/**
 * Abstract camera driver. One instance = one connected camera node.
 *
 * A Frame is `{ seq, position, buffer, mime, capturedAt }` — the JPEG stays in
 * memory only and is handed straight to the job queue.
 *
 * Events: 'info' (info), 'heartbeat' (info), 'close' (reason)
 */
export class CameraDriver extends EventEmitter {
  /** @param {{ deviceId: number, roomId: number|null, name: string }} device */
  constructor(device, kind) {
    super();
    this.deviceId = device.id;
    this.roomId = device.roomId ?? null;
    this.name = device.name;
    this.kind = kind;
    this.connectedAt = new Date();
    this.lastSeen = new Date();
    this.info = {};
    this.busy = false;
  }

  get online() {
    return false;
  }

  /**
   * @param {{ mode: 'attendance'|'behavior'|'test', shots: number, pan?: number[], countdown?: number }} _opts
   * @returns {Promise<Array<{seq:number, position:number|null, buffer:Buffer, mime:string, capturedAt:Date}>>}
   */
  // eslint-disable-next-line no-unused-vars
  async capture(_opts) {
    throw new Error('capture() not implemented');
  }

  /** Close the connection (e.g. token rotated, device disabled, heartbeat lost). */
  // eslint-disable-next-line no-unused-vars
  close(_reason) {}

  toJSON() {
    return {
      deviceId: this.deviceId,
      roomId: this.roomId,
      name: this.name,
      kind: this.kind,
      online: this.online,
      busy: this.busy,
      connectedAt: this.connectedAt,
      lastSeen: this.lastSeen,
      info: this.info,
    };
  }
}
