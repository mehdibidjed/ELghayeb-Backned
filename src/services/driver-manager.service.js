import { EventEmitter } from 'node:events';
import { DeviceError, DeviceErrorCode } from '../drivers/camera.driver.js';

/**
 * Keeps track of every connected camera driver and routes captures to the
 * camera of a room.
 *
 * Persistence (lastSeen / info in the devices table) is injected through
 * `store` so the manager stays testable without a database.
 *
 * Events: 'online' (driver), 'offline' ({ deviceId, roomId, reason }), 'info' (driver)
 */
export class DriverManager extends EventEmitter {
  /**
   * @param {{
   *   heartbeatTimeoutMs?: number,
   *   sweepIntervalMs?: number,
   *   store?: { touch(deviceId:number, data:{ lastSeen:Date, info?:object, ip?:string }): Promise<void> },
   *   logger?: any
   * }} opts
   */
  constructor(opts = {}) {
    super();
    /** @type {Map<number, import('../drivers/camera.driver.js').CameraDriver>} */
    this.drivers = new Map();
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 75_000;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 15_000;
    this.store = opts.store;
    this.log = opts.logger;
    this.sweeper = null;
  }

  start() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.sweeper.unref();
  }

  stop() {
    clearInterval(this.sweeper);
    this.sweeper = null;
    for (const driver of this.drivers.values()) driver.close('server shutting down');
    this.drivers.clear();
  }

  /** Register a freshly authenticated driver. A second connection of the same device replaces the first. */
  register(driver, { ip } = {}) {
    const previous = this.drivers.get(driver.deviceId);
    if (previous && previous !== driver) {
      this.log?.info({ deviceId: driver.deviceId }, 'device reconnected, replacing previous connection');
      previous.removeAllListeners('close');
      previous.close('replaced by a new connection');
    }

    this.drivers.set(driver.deviceId, driver);
    this.#persist(driver, ip);

    driver.on('info', () => {
      this.#persist(driver);
      this.emit('info', driver);
    });
    driver.on('heartbeat', () => this.#persist(driver));
    driver.once('close', (reason) => {
      if (this.drivers.get(driver.deviceId) === driver) {
        this.drivers.delete(driver.deviceId);
        this.#persist(driver);
        this.emit('offline', { deviceId: driver.deviceId, roomId: driver.roomId, reason });
      }
    });

    this.emit('online', driver);
    return driver;
  }

  get(deviceId) {
    const d = this.drivers.get(deviceId);
    return d?.online ? d : undefined;
  }

  /** The online camera of a room (most recently connected if several). */
  getByRoom(roomId) {
    let found;
    for (const d of this.drivers.values()) {
      if (d.roomId === roomId && d.online && (!found || d.connectedAt > found.connectedAt)) found = d;
    }
    return found;
  }

  isOnline(deviceId) {
    return Boolean(this.get(deviceId));
  }

  /** Called by the devices API when a device is moved to another room. */
  updateDevice(deviceId, { roomId, name }) {
    const d = this.drivers.get(deviceId);
    if (!d) return;
    if (roomId !== undefined) d.roomId = roomId;
    if (name !== undefined) d.name = name;
    this.emit('info', d);
  }

  /** Disconnect a device (disabled, deleted, token rotated). */
  disconnect(deviceId, reason) {
    this.drivers.get(deviceId)?.close(reason);
  }

  async captureFromRoom(roomId, opts) {
    const driver = this.getByRoom(roomId);
    if (!driver) throw new DeviceError(DeviceErrorCode.OFFLINE, `No online camera in room ${roomId}`);
    return driver.capture(opts);
  }

  async captureFromDevice(deviceId, opts) {
    const driver = this.get(deviceId);
    if (!driver) throw new DeviceError(DeviceErrorCode.OFFLINE, `Device ${deviceId} is offline`);
    return driver.capture(opts);
  }

  list() {
    return [...this.drivers.values()].map((d) => d.toJSON());
  }

  /** Drop drivers that stopped answering; ping the others. */
  sweep(now = Date.now()) {
    for (const d of this.drivers.values()) {
      if (now - d.lastSeen.getTime() > this.heartbeatTimeoutMs) {
        this.log?.warn({ deviceId: d.deviceId }, 'device heartbeat lost');
        d.close('heartbeat timeout');
      } else {
        d.ping?.();
      }
    }
  }

  #persist(driver, ip) {
    if (!this.store) return;
    this.store
      .touch(driver.deviceId, { lastSeen: driver.lastSeen, info: driver.info, ip })
      .catch((err) => this.log?.warn({ err, deviceId: driver.deviceId }, 'failed to persist device status'));
  }
}
