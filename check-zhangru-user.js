const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUser() {
  try {
    const user = await prisma.user.findUnique({
      where: { username: 'zhangru' },
      include: {
        doctor: true
      }
    });
    
    if (user) {
      console.log('用戶找到:');
      console.log('ID:', user.id);
      console.log('用戶名:', user.username);
      console.log('姓名:', user.name);
      console.log('角色:', user.role);
      console.log('是否有醫生資料:', !!user.doctor);
      if (user.doctor) {
        console.log('醫生ID:', user.doctor.id);
        console.log('專科:', user.doctor.specialty);
      }
    } else {
      console.log('用戶 zhangru 不存在');
    }
  } catch (error) {
    console.error('錯誤:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser();