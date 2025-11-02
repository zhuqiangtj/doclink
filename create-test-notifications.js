const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTestNotifications() {
  try {
    console.log('創建測試通知...');
    
    // 查找第一個醫生
    const doctor = await prisma.doctor.findFirst({
      include: {
        user: true
      }
    });
    
    if (!doctor) {
      console.log('沒有找到醫生');
      return;
    }
    
    console.log(`為醫生 ${doctor.user.name} 創建測試通知`);
    
    // 創建幾個測試通知
    const notifications = [
      {
        doctorId: doctor.id,
        appointmentId: 'test-appointment-1',
        patientName: '王小明',
        message: '病人王小明預約了明天上午10:00的診療',
        type: 'APPOINTMENT_CREATED',
        isRead: false
      },
      {
        doctorId: doctor.id,
        appointmentId: 'test-appointment-2',
        patientName: '李小華',
        message: '病人李小華取消了今天下午2:00的預約',
        type: 'APPOINTMENT_CANCELLED',
        isRead: false
      },
      {
        doctorId: doctor.id,
        appointmentId: 'test-appointment-3',
        patientName: '張小美',
        message: '病人張小美預約了後天上午9:30的診療',
        type: 'APPOINTMENT_CREATED',
        isRead: false
      }
    ];
    
    for (const notificationData of notifications) {
      const notification = await prisma.notification.create({
        data: notificationData
      });
      console.log(`創建通知: ${notification.message}`);
    }
    
    console.log('測試通知創建完成！');
    
  } catch (error) {
    console.error('創建測試通知時出錯:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestNotifications();