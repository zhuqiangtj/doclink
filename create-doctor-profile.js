const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createDoctorProfile() {
  try {
    // 查找doctor1用戶
    const user = await prisma.user.findUnique({
      where: { username: 'doctor1' }
    });
    
    if (!user) {
      console.log('Doctor1 user not found');
      return;
    }
    
    // 檢查是否已有醫生資料
    const existingProfile = await prisma.doctor.findUnique({
      where: { userId: user.id }
    });
    
    if (existingProfile) {
      console.log('Doctor profile already exists:', existingProfile);
      return;
    }
    
    // 創建醫生資料
    const doctorProfile = await prisma.doctor.create({
      data: {
        userId: user.id
      }
    });
    
    console.log('Doctor profile created successfully:', doctorProfile);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

createDoctorProfile();