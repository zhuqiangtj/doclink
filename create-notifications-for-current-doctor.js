const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createNotificationsForCurrentDoctor() {
  try {
    console.log('為當前醫生創建測試通知...');
    
    // 查找張醫生
    const doctor = await prisma.doctor.findUnique({
      where: { id: 'cmhfv2eo30001lh0w55xdps87' },
      include: {
        user: true
      }
    });
    
    if (!doctor) {
      console.log('沒有找到指定的醫生');
      return;
    }
    
    console.log(`為醫生 ${doctor.user.name} 創建測試通知`);
    
    // 創建幾個測試通知
    const notifications = [
      {
        doctorId: doctor.id,
        appointmentId: 'test-appointment-zhang-1',
        patientName: '陳小明',
        message: '病人陳小明預約了明天上午10:00的診療',
        type: 'APPOINTMENT_CREATED',
        isRead: false
      },
      {
        doctorId: doctor.id,
        appointmentId: 'test-appointment-zhang-2',
        patientName: '劉小華',
        message: '病人劉小華取消了今天下午2:00的預約',
        type: 'APPOINTMENT_CANCELLED',
        isRead: false
      },
      {
        doctorId: doctor.id,
        appointmentId: 'test-appointment-zhang-3',
        patientName: '黃小美',
        message: '病人黃小美預約了後天上午9:30的診療',
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

createNotificationsForCurrentDoctor();