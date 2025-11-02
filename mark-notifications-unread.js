const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function markNotificationsUnread() {
  try {
    console.log('將通知標記為未讀...');
    
    // 將張醫生的所有通知標記為未讀
    const result = await prisma.notification.updateMany({
      where: { 
        doctorId: 'cmhfv2eo30001lh0w55xdps87',
        isRead: true
      },
      data: { isRead: false }
    });
    
    console.log(`已將 ${result.count} 個通知標記為未讀`);
    
  } catch (error) {
    console.error('標記通知為未讀時出錯:', error);
  } finally {
    await prisma.$disconnect();
  }
}

markNotificationsUnread();