const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const doctors = await prisma.doctor.findMany({ include: { user: { select: { id: true, name: true } } } });
    for (const d of doctors) {
      console.log(`${d.id} ${d.user?.name} (userId=${d.user?.id})`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();