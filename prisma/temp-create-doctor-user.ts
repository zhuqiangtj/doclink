// prisma/temp-create-doctor-user.ts
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding temporary doctor user...');
  
  const tempEmail = 'temp-doctor@example.com';

  // Check if the user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: tempEmail },
  });

  if (existingUser) {
    console.log('Temporary doctor user already exists.');
    // Log the existing user's ID
    const existingDoctor = await prisma.doctor.findFirst({
      where: { userId: existingUser.id },
    });
    if (existingDoctor) {
      console.log(`Existing doctor ${existingDoctor.name} is already linked to user ${existingUser.id}`);
    }
    return;
  }

  // Create a placeholder user for the existing doctor(s)
  const user = await prisma.user.create({
    data: {
      email: tempEmail,
      password: 'temporary-password-hash', // Not for login, just a placeholder
      role: Role.DOCTOR,
    },
  });

  console.log(`Created temporary user with email: ${user.email} and ID: ${user.id}`);

  // Find the first doctor that doesn't have a userId yet
  const doctorToUpdate = await prisma.doctor.findFirst({
    where: {
      user: {
        isSet: false,
      },
    },
  });

  if (doctorToUpdate) {
    // Link the existing doctor to the new user
    const updatedDoctor = await prisma.doctor.update({
      where: { id: doctorToUpdate.id },
      data: { userId: user.id },
    });
    console.log(`Linked doctor ${updatedDoctor.name} (ID: ${updatedDoctor.id}) to new user (ID: ${user.id})`);
  } else {
    console.log('No doctors found that need to be linked to a user.');
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
