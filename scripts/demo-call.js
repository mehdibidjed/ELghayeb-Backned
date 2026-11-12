#!/usr/bin/env node
// Plays the teacher's web platform: login → today's sessions → "Lancer l'appel"
// → waits for attendance:done over Socket.IO → prints the attendance list.
//   node scripts/demo-call.js [email] [password]
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:3000';
const [email = 'prof@elghayeb.local', password = 'prof12345'] = process.argv.slice(2);

async function api(path, { token, ...init } = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}

const { token, user } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
console.log(`logged in as ${user.name} (${user.role})`);

const sessions = await api('/api/sessions?date=today', { token });
const session = sessions.find((s) => s.device.online) ?? sessions[0];
if (!session) throw new Error('No session today — run npm run db:seed');
console.log(`session #${session.id} ${session.group.name} room ${session.room.name} — camera ${session.device.online ? 'online' : 'OFFLINE'}`);

const socket = io(API, { auth: { token } });
await new Promise((resolve, reject) => {
  socket.on('connect', resolve);
  socket.on('connect_error', reject);
});
const joined = await socket.emitWithAck('session:join', session.id);
if (!joined.ok) throw new Error(`join failed: ${joined.error}`);

const done = new Promise((resolve, reject) => {
  socket.on('attendance:progress', (p) => console.log(`  … ${p.stage}`, p.frames ? `(${p.frames} frames)` : ''));
  socket.on('attendance:done', resolve);
  socket.on('attendance:error', (e) => reject(new Error(e.error)));
  setTimeout(() => reject(new Error('timeout waiting for attendance:done')), 180_000).unref();
});

const run = await api(`/api/sessions/${session.id}/attendance`, { method: 'POST', token });
console.log(`appel lancé: run #${run.runId} (${run.shots} shots)`);
const result = await done;
console.log('attendance:done', result.summary, `faces=${result.facesFound} unknown=${result.unknownFaces}`);

const list = await api(`/api/sessions/${session.id}/attendance`, { token });
for (const r of list.rows) {
  const a = r.attendance;
  console.log(`  ${r.student.matricule}  ${(a?.status ?? '—').padEnd(8)} ${a?.confidence?.toFixed(2) ?? ''}`);
}
socket.close();
