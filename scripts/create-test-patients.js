const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function upsertPatient({ username, name, gender, dateOfBirth, password }) {
  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    const hashedPassword = await bcrypt.hash(password, 10);

    let user;
    if (existing) {
      // Update password and basic fields if user exists
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          gender,
          dateOfBirth: new Date(dateOfBirth),
          password: hashedPassword,
          role: 'PATIENT',
        },
      });
      console.log(`[UPDATE] User ${username} updated.`);
    } else {
      user = await prisma.user.create({
        data: {
          username,
          name,
          gender,
          dateOfBirth: new Date(dateOfBirth),
          password: hashedPassword,
          role: 'PATIENT',
        },
      });
      console.log(`[CREATE] User ${username} created.`);
    }

    // Ensure patient profile exists
    const patientProfile = await prisma.patient.findUnique({ where: { userId: user.id } });
    if (!patientProfile) {
      await prisma.patient.create({ data: { userId: user.id } });
      console.log(`[CREATE] Patient profile for ${username} created.`);
    } else {
      console.log(`[SKIP] Patient profile for ${username} already exists.`);
    }
  } catch (error) {
    console.error(`[ERROR] Upsert patient ${username}:`, error.message);
  }
}

async function main() {
  const patients = [
    { username: 'p_wangxiaohua', name: '王小华', gender: 'Male',   dateOfBirth: '1991-02-14', password: '123456' },
    { username: 'p_lifang',      name: '李芳',   gender: 'Female', dateOfBirth: '1988-07-22', password: '123456' },
    { username: 'p_chenqiang',   name: '陈强',   gender: 'Male',   dateOfBirth: '1993-11-05', password: '123456' },
    { username: 'p_liumin',      name: '刘敏',   gender: 'Female', dateOfBirth: '1990-03-18', password: '123456' },
    { username: 'p_zhaoli',      name: '赵丽',   gender: 'Female', dateOfBirth: '1987-09-09', password: '123456' },
  ];

  console.log('Creating/updating test patient users...');
  for (const p of patients) {
    // eslint-disable-next-line no-await-in-loop
    await upsertPatient(p);
  }
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });