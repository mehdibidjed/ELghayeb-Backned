import { EventEmitter } from 'node:events';

/**
 * In-process event bus between services and the Socket.IO teacher gateway.
 *
 * Events:
 *  device:status        { deviceId, roomId, online, info? }
 *  attendance:progress  { sessionId, runId, stage, ... }
 *  attendance:done      { sessionId, runId, summary, records }
 *  attendance:error     { sessionId, runId, error }
 *  attendance:updated   { sessionId, record }        (manual correction)
 *  behavior:update      { sessionId, minute, stats, frame }
 *  behavior:status      { sessionId, active, reason? }
 */
export const bus = new EventEmitter();
bus.setMaxListeners(50);
