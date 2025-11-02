const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function recreateZhangruUser() {
  try {
    // 先檢查用戶是否存在
    const existingUser = await prisma.user.findUnique({
      where: { username: 'zhangru' }
    });

    if (existingUser) {
      console.log('用戶 zhangru 已存在，ID:', existingUser.id);
      return;
    }

    // 創建新用戶
    const hashedPassword = await bcrypt.hash('123456', 10);
    
    const newUser = await prisma.user.create({
      data: {
        username: 'zhangru',
        password: hashedPassword,
        name: '張如醫生',
        role: 'DOCTOR'
      }
    });

    console.log('用戶 zhangru 創建成功，ID:', newUser.id);

    // 創建醫生資料
    const doctor = await prisma.doctor.create({
      data: {
        userId: newUser.id,
        specialty: '內科',
        licenseNumber: 'DOC001'
      }
    });

    console.log('醫生資料創建成功，ID:', doctor.id);

  } catch (error) {
    console.error('錯誤:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

recreateZhangruUser();