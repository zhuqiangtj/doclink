import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('DATABASE_URL in use:', process.env.DATABASE_URL);
  const adminUsername = 'admin';
  console.log(`Seeding database... Attempting to create/update user: ${adminUsername}`);

  // 1. Delete the admin user if it exists to ensure a clean slate
  try {
    const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } });
    if (existingAdmin) {
      console.log(`Found existing admin user. Deleting it first...`);
      // Prisma does not cascade deletes automatically on non-native fields.
      // We don't expect the admin to have appointments, but this is good practice.
      await prisma.appointment.deleteMany({ where: { userId: existingAdmin.id } });
      await prisma.patient.deleteMany({ where: { userId: existingAdmin.id } });
      await prisma.doctor.deleteMany({ where: { userId: existingAdmin.id } });
      await prisma.user.delete({ where: { username: adminUsername } });
      console.log(`User ${adminUsername} deleted.`);
    }
  } catch (error) {
    console.error(`Error during deletion phase (might be safe to ignore if user did not exist):`, error);
  }

  // 2. Create the new admin user with specified details
  try {
    const adminPassword = 'admin123';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    const adminUser = await prisma.user.create({
      data: {
        username: adminUsername,
        name: 'Admin',
        gender: 'Male',
        dateOfBirth: new Date('1976-08-14T00:00:00.000Z'), // Use ISO format for consistency
        password: hashedPassword,
        role: Role.ADMIN,
      },
    });

    console.log(`Successfully created new admin user: ${adminUser.username}`);

  } catch (e) {
    console.error('Error creating new admin user:', e);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });