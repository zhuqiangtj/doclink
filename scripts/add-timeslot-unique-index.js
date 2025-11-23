const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Creating unique index on TimeSlot(scheduleId, startTime, endTime)...');
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "TimeSlot_scheduleId_startTime_endTime_key" ON "TimeSlot"("scheduleId","startTime","endTime");');
    console.log('Unique index created (or already exists).');
  } catch (e) {
    console.error('Failed to create unique index:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();