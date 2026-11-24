import { CameraDriver, DeviceError, DeviceErrorCode } from './camera.driver.js';

/**
 * Driver for ESP32-CAM running in Access Point (AP) mode at http://192.168.4.1
 */
export class Esp32ApDriver extends CameraDriver {
  /**
   * @param {{ id: number, roomId: number|null, name: string }} device
   * @param {{ baseUrl?: string, logger?: any }} opts
   */
  constructor(device, opts = {}) {
    super(device, 'esp32-cam-ap');
    this.baseUrl = opts.baseUrl ?? 'http://10.126.242.231';
    this.log = opts.logger;
    this.isOnline = true;
    this.consecutiveErrors = 0;
    this.info = { firmware: '1.0.0-ap', camera: 'ESP32-CAM', resolution: '1600x1200' };

    // Initial check and periodic heartbeat ping
    this.checkHealth();
    this.pingTimer = setInterval(() => this.ping(), 10000);
    this.pingTimer.unref?.();
  }

  get online() {
    return this.isOnline;
  }

  async ping() {
    if (this.busy) return true;
    return this.checkHealth();
  }

  async checkHealth() {
    if (this.busy) return true;
    try {
      const res = await fetch(`${this.baseUrl}/telemetry`, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = await res.json();
        this.info = { ...this.info, ...data };
        this.lastSeen = new Date();
        this.consecutiveErrors = 0;
        const wasOffline = !this.isOnline;
        this.isOnline = true;
        if (wasOffline) {
          this.emit('online', this);
        }
        this.emit('heartbeat', this.info);
        this.emit('info', this.info);
        return true;
      }
    } catch (err) {
      this.consecutiveErrors = (this.consecutiveErrors || 0) + 1;
      if (this.consecutiveErrors >= 4) {
        this.isOnline = false;
      }
      this.log?.warn({ err: err.message, fails: this.consecutiveErrors }, 'ESP32-CAM healthcheck attempt failed');
    }
    return false;
  }

  async capture({ mode, shots = 3, pan = [-40, 0, 40], countdown = 3 }) {
    if (!this.online) {
      throw new DeviceError(DeviceErrorCode.OFFLINE, 'ESP32-CAM AP is unreachable');
    }

    this.busy = true;
    const frames = [];

    try {
      // 1. If countdown is needed, run the countdown on the ESP32
      if (countdown > 0) {
        this.log?.info({ countdown }, 'Running countdown on ESP32-CAM LEDs...');
      }

      const angles = (pan && pan.length >= shots) ? pan.slice(0, shots) : [-40, 0, 40].slice(0, shots);

      // 2. Capture each angle
      for (let seq = 0; seq < shots; seq++) {
        const pos = angles[seq] ?? 0;
        this.log?.info({ seq, pos }, 'Capturing frame from ESP32-CAM...');

        const url = `${this.baseUrl}/capture?pos=${pos}&t=${Date.now()}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

        if (!res.ok) {
          throw new DeviceError(DeviceErrorCode.BAD_FRAME, `Failed to capture shot ${seq} (HTTP ${res.status})`);
        }

        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        frames.push({
          seq,
          position: pos,
          buffer,
          mime: 'image/jpeg',
          capturedAt: new Date(),
        });

        // Small delay between shots
        await new Promise((r) => setTimeout(r, 200));
      }

      this.lastSeen = new Date();
      return frames;
    } catch (err) {
      this.log?.error({ err }, 'Error during ESP32-CAM capture');
      throw err;
    } finally {
      this.busy = false;
    }
  }

  close(reason = 'closed') {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.isOnline = false;
    this.emit('close', reason);
  }
}
