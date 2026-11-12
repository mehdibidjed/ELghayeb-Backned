import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { CameraDriver, DeviceError, DeviceErrorCode } from './camera.driver.js';

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const isJpeg = (buf) => buf.length > 3 && JPEG_MAGIC.every((b, i) => buf[i] === b);

/**
 * Driver for a Raspberry Pi Zero camera node over WebSocket.
 * Protocol: docs/device-protocol.md
 *
 *   server → device  {"cmd":"capture","requestId","mode","shots","pan":[-40,0,40],"countdown":3}
 *   device → server  {"type":"frame","requestId","seq","position"} then 1 binary JPEG message
 *   device → server  {"type":"capture_done","requestId"} | {"type":"error","requestId","message"}
 *   device → server  {"type":"hello",...} once, {"type":"ping",...} every ~30 s
 */
export class PiZeroDriver extends CameraDriver {
  /**
   * @param {WebSocket} ws
   * @param {{ id:number, roomId:number|null, name:string }} device
   * @param {{ captureTimeoutMs?: number, maxFrameBytes?: number, logger?: any }} opts
   */
  constructor(ws, device, opts = {}) {
    super(device, 'rpi-zero');
    this.ws = ws;
    this.captureTimeoutMs = opts.captureTimeoutMs ?? 30_000;
    this.maxFrameBytes = opts.maxFrameBytes ?? 8 * 1024 * 1024;
    this.log = opts.logger;

    /** @type {null | { requestId, shots, frames, pendingHeader, resolve, reject, timer }} */
    this.pending = null;
    this.lock = Promise.resolve(); // serialises captures: one camera, one capture at a time
    this.closed = false;

    ws.on('message', (data, isBinary) => this.#onMessage(data, isBinary));
    ws.on('pong', () => this.#touch());
    ws.on('close', (code, reason) => this.#onClose(`socket closed (${code}${reason?.length ? `: ${reason}` : ''})`));
    ws.on('error', (err) => this.log?.warn({ err, deviceId: this.deviceId }, 'device socket error'));
  }

  get online() {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  send(message) {
    if (!this.online) throw new DeviceError(DeviceErrorCode.OFFLINE, `Device ${this.deviceId} is offline`);
    this.ws.send(JSON.stringify(message));
  }

  /** WebSocket-level ping; the pong refreshes lastSeen. */
  ping() {
    if (this.online) this.ws.ping();
  }

  capture({ mode, shots, pan, countdown = 0 }) {
    const run = () => this.#capture({ mode, shots, pan, countdown });
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => {});
    return result;
  }

  #capture({ mode, shots, pan, countdown }) {
    if (!this.online) {
      return Promise.reject(new DeviceError(DeviceErrorCode.OFFLINE, `Device ${this.deviceId} is offline`));
    }
    const requestId = randomUUID();
    // Countdown + servo moves happen on the device: give it that time on top of the timeout.
    const timeoutMs = this.captureTimeoutMs + countdown * 1000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#finish(new DeviceError(DeviceErrorCode.TIMEOUT, `Capture timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending = { requestId, shots, frames: [], pendingHeader: null, resolve, reject, timer };
      this.busy = true;
      try {
        this.send({ cmd: 'capture', requestId, mode, shots, pan: pan?.slice(0, shots) ?? null, countdown });
      } catch (err) {
        this.#finish(err);
      }
    });
  }

  #finish(err) {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    this.busy = false;
    if (err) p.reject(err);
    else p.resolve(p.frames.sort((a, b) => a.seq - b.seq));
  }

  #touch() {
    this.lastSeen = new Date();
  }

  #onMessage(data, isBinary) {
    this.#touch();
    if (isBinary) return this.#onBinary(Buffer.isBuffer(data) ? data : Buffer.concat([].concat(data)));

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this.log?.warn({ deviceId: this.deviceId }, 'non-JSON text message from device ignored');
      return;
    }

    switch (msg.type) {
      case 'hello':
        this.info = { ...this.info, ...pick(msg, ['firmware', 'camera', 'resolution', 'hostname', 'servo']) };
        this.emit('info', this.info);
        break;
      case 'ping':
        this.info = { ...this.info, ...pick(msg, ['rssi', 'cpuTemp', 'uptime', 'freeMem', 'heap']) };
        this.emit('heartbeat', this.info);
        this.send({ type: 'pong', t: Date.now() });
        break;
      case 'frame': {
        const p = this.pending;
        if (!p || msg.requestId !== p.requestId) return; // late frame from a timed-out request
        p.pendingHeader = { seq: Number(msg.seq ?? p.frames.length), position: msg.position ?? null };
        break;
      }
      case 'capture_done': {
        const p = this.pending;
        if (!p || msg.requestId !== p.requestId) return;
        if (p.frames.length === 0) {
          this.#finish(new DeviceError(DeviceErrorCode.BAD_FRAME, 'Device finished the capture without sending frames'));
        } else {
          this.#finish(null); // fewer frames than requested is accepted (e.g. one shot failed)
        }
        break;
      }
      case 'error': {
        const p = this.pending;
        if (p && (!msg.requestId || msg.requestId === p.requestId)) {
          this.#finish(new DeviceError(DeviceErrorCode.REMOTE, msg.message ?? 'Device reported an error'));
        } else {
          this.log?.warn({ deviceId: this.deviceId, msg }, 'device error');
        }
        break;
      }
      default:
        this.log?.debug({ deviceId: this.deviceId, type: msg.type }, 'unknown device message type');
    }
  }

  #onBinary(buffer) {
    const p = this.pending;
    if (!p) return; // nobody asked for a frame: drop it
    if (buffer.length > this.maxFrameBytes) {
      return this.#finish(new DeviceError(DeviceErrorCode.BAD_FRAME, `Frame too large (${buffer.length} bytes)`));
    }
    if (!isJpeg(buffer)) {
      return this.#finish(new DeviceError(DeviceErrorCode.BAD_FRAME, 'Frame is not a JPEG'));
    }
    // Header is optional: a bare binary frame gets the next sequence number.
    const header = p.pendingHeader ?? { seq: p.frames.length, position: null };
    p.pendingHeader = null;
    p.frames.push({ ...header, buffer, mime: 'image/jpeg', capturedAt: new Date() });
    if (p.frames.length >= p.shots) this.#finish(null);
  }

  #onClose(reason) {
    if (this.closed) return;
    this.closed = true;
    this.#finish(new DeviceError(DeviceErrorCode.CLOSED, `Device disconnected: ${reason}`));
    this.emit('close', reason);
  }

  close(reason = 'closed by server') {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(4000, reason.slice(0, 120));
      // Don't wait forever for the closing handshake of a dead device.
      setTimeout(() => this.ws.terminate(), 2000).unref();
    }
    this.#onClose(reason);
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
