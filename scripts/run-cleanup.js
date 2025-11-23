const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

(async () => {
  const prisma = new PrismaClient();
  try {
    const sqlPath = path.join(__dirname, 'cleanup.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Executing cleanup SQL...');
    await prisma.$executeRawUnsafe(sql);
    console.log('Cleanup done. Verifying counts...');
    const tables = [
      'AppointmentHistory',
      'Notification',
      'PatientNotification',
      'AuditLog',
      'Appointment',
      'TimeSlot',
      'Schedule',
      'Room',
      'Session',
      'VerificationToken',
    ];
    for (const t of tables) {
      try {
        const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${t}";`);
        const count = Array.isArray(rows) && rows[0] && rows[0].count != null ? rows[0].count : null;
        console.log(`${t}: ${count}`);
      } catch (e) {
        console.warn(`Count check failed for ${t}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Cleanup failed:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();