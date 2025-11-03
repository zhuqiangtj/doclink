const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDoctorInfo() {
  try {
    const doctors = await prisma.doctor.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            role: true
          }
        }
      }
    });
    
    console.log('所有醫生信息:');
    doctors.forEach((doctor, index) => {
      console.log('醫生 ' + (index + 1) + ':', {
        doctorId: doctor.id,
        userId: doctor.userId,
        userName: doctor.user.name,
        userUsername: doctor.user.username,
        userRole: doctor.user.role
      });
    });
  } catch (error) {
    console.error('查詢醫生信息失敗:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDoctorInfo();