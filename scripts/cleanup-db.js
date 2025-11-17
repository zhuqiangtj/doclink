const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('[Cleanup] Start');
  await prisma.$transaction(async (tx) => {
    await tx.appointmentHistory.deleteMany({});
    await tx.notification.deleteMany({});
    await tx.patientNotification.deleteMany({});
    await tx.auditLog.deleteMany({});
    await tx.appointment.deleteMany({});
    await tx.timeSlot.deleteMany({});
    await tx.schedule.deleteMany({});
    await tx.room.deleteMany({});
    await tx.session.deleteMany({});
    await tx.verificationToken.deleteMany({});
  }, { timeout: 120000 });

  const users = await prisma.user.count();
  const doctors = await prisma.doctor.count();
  const patients = await prisma.patient.count();
  const accounts = await prisma.account.count();

  console.log('[Cleanup] Done');
  console.log(`[Remain] users=${users}, doctors=${doctors}, patients=${patients}, accounts=${accounts}`);
}

main()
  .catch((err) => {
    console.error('[Cleanup] Failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });