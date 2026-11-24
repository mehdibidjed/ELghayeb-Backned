import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sampleStudents = [
  { matricule: '202231045001', name: 'Houssem Eddine', groupId: 1 },
  { matricule: '202231045002', name: 'Amine Benali', groupId: 1 },
  { matricule: '202231045003', name: 'Sarah Mansouri', groupId: 1 },
  { matricule: '202231045004', name: 'Karim Ziani', groupId: 1 },
  { matricule: '202231045005', name: 'Yasmine Boudiaf', groupId: 1 },
];

async function main() {
  for (const s of sampleStudents) {
    const student = await prisma.student.upsert({
      where: { matricule: s.matricule },
      update: { name: s.name, groupId: s.groupId },
      create: s,
    });
    const vector = Array.from({ length: 512 }, () => (Math.random() * 2 - 1) / Math.sqrt(512));
    await prisma.faceEmbedding.deleteMany({ where: { studentId: student.id } });
    await prisma.faceEmbedding.create({
      data: { studentId: student.id, vector, detScore: 0.99 },
    });
  }
  console.log('Seeded sample students with embeddings successfully!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
