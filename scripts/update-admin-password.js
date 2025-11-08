const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function run() {
  const username = 'admin';
  const newPasswordPlain = 'admin123';
  try {
    let user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      console.warn(`[WARN] User '${username}' not found. Creating admin user...`);
      user = await prisma.user.create({
        data: {
          username,
          name: '系統管理員',
          role: 'ADMIN',
          password: await bcrypt.hash(newPasswordPlain, 10),
        },
      });
      console.log(`[OK] Admin user '${username}' created.`);
      return;
    }
    if (user.role !== 'ADMIN') {
      console.warn(`[WARN] User '${username}' exists with role ${user.role}. Updating role to ADMIN.`);
    }

    const hashed = await bcrypt.hash(newPasswordPlain, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, role: 'ADMIN' },
    });
    console.log(`[OK] Updated password for admin '${username}'.`);
  } catch (err) {
    console.error('[ERROR] Failed to update admin password:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();