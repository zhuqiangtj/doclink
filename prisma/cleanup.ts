import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Start deleting non-admin users...');

  try {
    // Find all non-admin users
    const usersToDelete = await prisma.user.findMany({
      where: {
        username: {
          not: 'admin',
        },
      },
      include: {
        doctorProfile: true,
        patientProfile: true,
      },
    });

    if (usersToDelete.length === 0) {
      console.log('No non-admin users to delete.');
      return;
    }

    // This is a simplified cascade delete. 
    // We need to delete dependent records in the correct order.
    for (const user of usersToDelete) {
      console.log(`Deleting data for user: ${user.username}`);

      // For doctors, find their doctor profile to delete related data
      if (user.doctorProfile) {
        const doctorId = user.doctorProfile.id;
        await prisma.schedule.deleteMany({ where: { doctorId: doctorId } });
        await prisma.room.deleteMany({ where: { doctorId: doctorId } });
      }

      // Delete related records first
      await prisma.appointment.deleteMany({ where: { userId: user.id } });
      await prisma.doctor.deleteMany({ where: { userId: user.id } });
      await prisma.patient.deleteMany({ where: { userId: user.id } });
      await prisma.account.deleteMany({ where: { userId: user.id } });
      await prisma.session.deleteMany({ where: { userId: user.id } });

      // Finally, delete the user
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`Deleted user: ${user.username}`);
    }

    console.log(`Successfully deleted ${usersToDelete.length} non-admin users.`);

  } catch (error) {
    console.error('Failed to delete users:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
