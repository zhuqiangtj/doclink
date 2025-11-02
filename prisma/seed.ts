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

  // 3. Create test patient users
  try {
    const testPatients = [
      {
        username: 'patient1',
        name: '李小明',
        gender: 'Male',
        dateOfBirth: new Date('1990-05-15T00:00:00.000Z'),
        password: 'patient123'
      },
      {
        username: 'patient2', 
        name: '王美麗',
        gender: 'Female',
        dateOfBirth: new Date('1985-03-20T00:00:00.000Z'),
        password: 'patient123'
      },
      {
        username: 'patient3',
        name: '張志強',
        gender: 'Male', 
        dateOfBirth: new Date('1992-11-08T00:00:00.000Z'),
        password: 'patient123'
      },
      {
        username: 'patient4',
        name: '李雅婷',
        gender: 'Female',
        dateOfBirth: new Date('1988-07-12T00:00:00.000Z'),
        password: 'patient123'
      }
    ];

    for (const patientData of testPatients) {
      // Delete existing patient if exists
      const existingPatient = await prisma.user.findUnique({ where: { username: patientData.username } });
      if (existingPatient) {
        await prisma.appointment.deleteMany({ where: { userId: existingPatient.id } });
        await prisma.patient.deleteMany({ where: { userId: existingPatient.id } });
        await prisma.user.delete({ where: { username: patientData.username } });
      }

      const hashedPassword = await bcrypt.hash(patientData.password, 10);
      
      const patientUser = await prisma.user.create({
        data: {
          username: patientData.username,
          name: patientData.name,
          gender: patientData.gender,
          dateOfBirth: patientData.dateOfBirth,
          password: hashedPassword,
          role: Role.PATIENT,
        },
      });

      // Create patient record
      await prisma.patient.create({
        data: {
          userId: patientUser.id,
        },
      });

      console.log(`Successfully created test patient: ${patientUser.name} (${patientUser.username})`);
    }

  } catch (e) {
    console.error('Error creating test patients:', e);
    process.exit(1);
  }

  // 4. Create test doctor users
  try {
    const testDoctors = [
      {
        username: 'zhangru',
        name: '張如醫生',
        gender: 'Female',
        dateOfBirth: new Date('1975-06-10T00:00:00.000Z'),
        password: '123456'
      }
    ];

    for (const doctorData of testDoctors) {
      // Delete existing doctor if exists
      const existingDoctor = await prisma.user.findUnique({ 
        where: { username: doctorData.username },
        include: { doctorProfile: true }
      });
      if (existingDoctor) {
        if (existingDoctor.doctorProfile) {
          await prisma.appointment.deleteMany({ where: { doctorId: existingDoctor.doctorProfile.id } });
          await prisma.doctor.delete({ where: { userId: existingDoctor.id } });
        }
        await prisma.user.delete({ where: { username: doctorData.username } });
      }

      const hashedPassword = await bcrypt.hash(doctorData.password, 10);
      
      const doctorUser = await prisma.user.create({
        data: {
          username: doctorData.username,
          name: doctorData.name,
          gender: doctorData.gender,
          dateOfBirth: doctorData.dateOfBirth,
          password: hashedPassword,
          role: Role.DOCTOR,
        },
      });

      // Create doctor record
      await prisma.doctor.create({
        data: {
          userId: doctorUser.id,
        },
      });

      console.log(`Successfully created test doctor: ${doctorUser.name} (${doctorUser.username})`);
    }

  } catch (e) {
    console.error('Error creating test doctors:', e);
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