// npm run db:seed [-- --with-faces]
// Creates an admin, a teacher, group GL5-G2, room S12 with one Pi Zero camera,
// the 3 students of ../vision_model/data/students and a session happening now.
// --with-faces enrols their photos through the AI service (must be running).
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { newDeviceToken, sha256 } from '../src/lib/crypto.js';

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));
const STUDENTS_DIR = process.env.SEED_STUDENTS_DIR ?? path.resolve(here, '../../vision_model/data/students');
const withFaces = process.argv.includes('--with-faces');

async function upsertTeacher(email, name, password, role) {
  return prisma.teacher.upsert({
    where: { email },
    update: {},
    create: { email, name, role, passwordHash: await bcrypt.hash(password, 10) },
  });
}

async function enrol(studentId, dir) {
  const { AiClient } = await import('../src/ai/ai.client.js');
  const ai = new AiClient({ baseUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8000', timeoutMs: 120_000 });
  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png)$/i.test(f));
  await prisma.faceEmbedding.deleteMany({ where: { studentId } });
  let accepted = 0;
  for (const f of files) {
    const { faces } = await ai.embedFace(await readFile(path.join(dir, f)), f);
    if (faces.length !== 1) {
      console.log(`    skipped ${f}: ${faces.length} faces`);
      continue;
    }
    await prisma.faceEmbedding.create({ data: { studentId, vector: faces[0].embedding, detScore: faces[0].det_score } });
    accepted++;
  }
  return accepted;
}

async function main() {
  const admin = await upsertTeacher(
    process.env.SEED_ADMIN_EMAIL ?? 'admin@elghayeb.local',
    'Administrateur',
    process.env.SEED_ADMIN_PASSWORD ?? 'admin12345',
    'ADMIN',
  );
  const teacher = await upsertTeacher('prof@elghayeb.local', 'Pr Chaouche', 'prof12345', 'TEACHER');

  const group = await prisma.group.upsert({ where: { name: 'GL5-G2' }, update: {}, create: { name: 'GL5-G2', level: 'GL5' } });
  const room = await prisma.room.upsert({ where: { name: 'S12' }, update: {}, create: { name: 'S12', depthM: 8 } });

  // A fresh token each seed run (only the hash is stored).
  const token = newDeviceToken();
  const existing = await prisma.device.findFirst({ where: { name: 'pi-zero-s12' } });
  const device = existing
    ? await prisma.device.update({ where: { id: existing.id }, data: { tokenHash: sha256(token), roomId: room.id } })
    : await prisma.device.create({ data: { name: 'pi-zero-s12', roomId: room.id, tokenHash: sha256(token) } });

  let folders = [];
  try {
    folders = (await readdir(STUDENTS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    console.warn(`No students folder at ${STUDENTS_DIR}; skipping students.`);
  }
  for (const matricule of folders) {
    const student = await prisma.student.upsert({
      where: { matricule },
      update: { groupId: group.id },
      create: { matricule, name: `Étudiant ${matricule}`, groupId: group.id },
    });
    if (withFaces) {
      const n = await enrol(student.id, path.join(STUDENTS_DIR, matricule));
      console.log(`  enrolled ${matricule}: ${n} photo(s)`);
    }
  }

  const now = new Date();
  const startsAt = new Date(now.getTime() - 10 * 60_000);
  const endsAt = new Date(now.getTime() + 80 * 60_000);
  const session = await prisma.session.create({
    data: { groupId: group.id, roomId: room.id, teacherId: teacher.id, subject: 'IoT', startsAt, endsAt },
  });

  console.log('\nSeed done.');
  console.log(`  admin    ${admin.email} / ${process.env.SEED_ADMIN_PASSWORD ?? 'admin12345'}`);
  console.log(`  teacher  ${teacher.email} / prof12345`);
  console.log(`  session  #${session.id} (${group.name}, room ${room.name}, now)`);
  console.log(`  device   #${device.id} ${device.name}  token: ${token}`);
  console.log(`\n  Simulate the Pi:  DEVICE_TOKEN=${token} npm run simulate:device`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
