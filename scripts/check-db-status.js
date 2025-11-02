const { PrismaClient } = require('@prisma/client');

async function checkDatabaseStatus() {
  const prisma = new PrismaClient();
  
  try {
    console.log('Connecting to database...');
    
    // 檢查預約狀態值
    const appointments = await prisma.appointment.findMany({
      select: { status: true }
    });
    
    console.log('Raw appointments data:', appointments.slice(0, 5)); // 顯示前5個
    
    const uniqueStatuses = [...new Set(appointments.map(a => a.status))];
    console.log('Current appointment statuses in database:', uniqueStatuses);
    
    // 檢查總數
    console.log('Total appointments:', appointments.length);
    
    // 檢查每個狀態的數量
    const statusCounts = {};
    appointments.forEach(apt => {
      statusCounts[apt.status] = (statusCounts[apt.status] || 0) + 1;
    });
    console.log('Status counts:', statusCounts);
    
  } catch (error) {
    console.error('Error checking database status:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabaseStatus();