const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createDoctor() {
  try {
    // 檢查用戶是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { username: 'doctor1' }
    });

    if (existingUser) {
      console.log('Doctor1 user already exists');
      return;
    }

    // 創建密碼哈希
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    // 創建用戶
    const doctorUser = await prisma.user.create({
      data: {
        username: 'doctor1',
        name: '張醫生',
        gender: 'Male',
        dateOfBirth: new Date('1980-01-01T00:00:00.000Z'),
        password: hashedPassword,
        role: 'DOCTOR',
      },
    });

    console.log('Created doctor user:', doctorUser.username);

    // 創建醫生記錄
    const doctor = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
      },
    });

    console.log('Created doctor record for user:', doctorUser.name);

  } catch (error) {
    console.error('Error creating doctor:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

createDoctor();