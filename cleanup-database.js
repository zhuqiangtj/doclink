const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function cleanupDatabase() {
  console.log('開始清理數據庫...');
  
  try {
    // 按照外鍵依賴順序刪除數據
    console.log('1. 清理預約歷史記錄...');
    const appointmentHistoryCount = await prisma.appointmentHistory.deleteMany({});
    console.log(`   已刪除 ${appointmentHistoryCount.count} 條預約歷史記錄`);

    console.log('2. 清理預約記錄...');
    const appointmentCount = await prisma.appointment.deleteMany({});
    console.log(`   已刪除 ${appointmentCount.count} 條預約記錄`);

    console.log('3. 清理排班記錄...');
    const scheduleCount = await prisma.schedule.deleteMany({});
    console.log(`   已刪除 ${scheduleCount.count} 條排班記錄`);

    console.log('4. 清理房間記錄...');
    const roomCount = await prisma.room.deleteMany({});
    console.log(`   已刪除 ${roomCount.count} 條房間記錄`);

    console.log('5. 清理醫生通知...');
    const notificationCount = await prisma.notification.deleteMany({});
    console.log(`   已刪除 ${notificationCount.count} 條醫生通知`);

    console.log('6. 清理患者通知...');
    const patientNotificationCount = await prisma.patientNotification.deleteMany({});
    console.log(`   已刪除 ${patientNotificationCount.count} 條患者通知`);

    console.log('7. 清理審計日誌...');
    const auditLogCount = await prisma.auditLog.deleteMany({});
    console.log(`   已刪除 ${auditLogCount.count} 條審計日誌`);

    console.log('\n✅ 數據庫清理完成！');
    console.log('\n保留的數據：');
    
    // 檢查保留的數據
    const userCount = await prisma.user.count();
    const doctorCount = await prisma.doctor.count();
    const patientCount = await prisma.patient.count();
    const accountCount = await prisma.account.count();
    const sessionCount = await prisma.session.count();
    
    console.log(`   用戶賬戶: ${userCount} 個`);
    console.log(`   醫生檔案: ${doctorCount} 個`);
    console.log(`   患者檔案: ${patientCount} 個`);
    console.log(`   賬戶關聯: ${accountCount} 個`);
    console.log(`   活躍會話: ${sessionCount} 個`);

    console.log('\n已清除的數據類型：');
    console.log('   ✓ 所有預約記錄和歷史');
    console.log('   ✓ 所有排班記錄');
    console.log('   ✓ 所有房間記錄');
    console.log('   ✓ 所有通知記錄');
    console.log('   ✓ 所有審計日誌');
    
  } catch (error) {
    console.error('❌ 清理過程中發生錯誤:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 執行清理
cleanupDatabase()
  .then(() => {
    console.log('\n🎉 數據庫清理成功完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 數據庫清理失敗:', error);
    process.exit(1);
  });