import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding admin user...');

  const adminEmail = 'admin@doclink.com';
  const adminUsername = 'admin'; // New: Admin username
  const adminPassword = 'admin123';

  // Check if the admin user already exists by username
  const existingAdmin = await prisma.user.findUnique({
    where: { username: adminUsername },
  });

  if (existingAdmin) {
    console.log('Admin user already exists.');
    return;
  }

  // Hash the password
  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  console.log(`Generated password hash for admin: ${hashedPassword}`);

  // Create the admin user
  const adminUser = await prisma.user.create({
    data: {
      username: adminUsername, // New: Add username
      name: 'Admin', // New: Add name
      email: adminEmail,
      password: hashedPassword,
      role: Role.ADMIN,
    },
  });

  console.log(`Created admin user with username: ${adminUser.username}`);
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
