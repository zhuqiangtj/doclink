const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const patients = await prisma.user.findMany({
      where: { role: 'PATIENT' },
      select: { id: true, username: true }
    });

    console.log(`Found ${patients.length} patient users to delete.`);

    for (const u of patients) {
      console.log(`Deleting patient user: ${u.username} (${u.id})`);
      await prisma.$transaction(async (tx) => {
        await tx.patient.deleteMany({ where: { userId: u.id } });
        await tx.account.deleteMany({ where: { userId: u.id } });
        await tx.session.deleteMany({ where: { userId: u.id } });
        await tx.user.delete({ where: { id: u.id } });
      }, { timeout: 20000 });
      console.log(`Deleted: ${u.username}`);
    }

    const remaining = await prisma.user.count({ where: { role: 'PATIENT' } });
    console.log(`Remaining patient users: ${remaining}`);
  } catch (e) {
    console.error('Failed to delete patient users:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();