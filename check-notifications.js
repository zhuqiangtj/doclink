const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkNotifications() {
  try {
    console.log('檢查通知數據...');
    
    // 查找所有醫生
    const doctors = await prisma.doctor.findMany({
      include: {
        user: true
      }
    });
    
    console.log(`找到 ${doctors.length} 個醫生`);
    
    for (const doctor of doctors) {
      console.log(`\n醫生: ${doctor.user.name} (ID: ${doctor.id})`);
      
      // 查找該醫生的所有通知
      const notifications = await prisma.notification.findMany({
        where: { doctorId: doctor.id },
        orderBy: { createdAt: 'desc' }
      });
      
      const unreadCount = notifications.filter(n => !n.isRead).length;
      
      console.log(`  總通知數: ${notifications.length}`);
      console.log(`  未讀通知數: ${unreadCount}`);
      
      if (notifications.length > 0) {
        console.log('  最近的通知:');
        notifications.slice(0, 3).forEach(n => {
          console.log(`    - ${n.type}: ${n.message} (已讀: ${n.isRead})`);
        });
      }
    }
    
  } catch (error) {
    console.error('檢查通知時出錯:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkNotifications();