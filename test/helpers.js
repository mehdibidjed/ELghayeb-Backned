process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-test-secret';

import { once } from 'node:events';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

/** A connected (serverSocket, clientSocket) pair over a real local WebSocket. */
export async function wsPair() {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  server.listen(0);
  await once(server, 'listening');
  const client = new WebSocket(`ws://localhost:${server.address().port}`);
  const [serverSide] = await once(wss, 'connection');
  await once(client, 'open');
  return {
    serverSide,
    client,
    close: () => {
      client.terminate();
      wss.close();
      server.close();
    },
  };
}
