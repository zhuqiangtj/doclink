const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyCleanup() {
  console.log('驗證數據庫清理結果...\n');
  
  try {
    // 檢查保留的表
    console.log('=== 保留的數據 ===');
    const userCount = await prisma.user.count();
    const doctorCount = await prisma.doctor.count();
    const patientCount = await prisma.patient.count();
    const accountCount = await prisma.account.count();
    const sessionCount = await prisma.session.count();
    const verificationTokenCount = await prisma.verificationToken.count();
    
    console.log(`用戶 (User): ${userCount} 條記錄`);
    console.log(`醫生檔案 (Doctor): ${doctorCount} 條記錄`);
    console.log(`患者檔案 (Patient): ${patientCount} 條記錄`);
    console.log(`賬戶關聯 (Account): ${accountCount} 條記錄`);
    console.log(`會話 (Session): ${sessionCount} 條記錄`);
    console.log(`驗證令牌 (VerificationToken): ${verificationTokenCount} 條記錄`);

    // 檢查已清理的表
    console.log('\n=== 已清理的數據 ===');
    const appointmentCount = await prisma.appointment.count();
    const appointmentHistoryCount = await prisma.appointmentHistory.count();
    const scheduleCount = await prisma.schedule.count();
    const roomCount = await prisma.room.count();
    const notificationCount = await prisma.notification.count();
    const patientNotificationCount = await prisma.patientNotification.count();
    const auditLogCount = await prisma.auditLog.count();
    
    console.log(`預約 (Appointment): ${appointmentCount} 條記錄`);
    console.log(`預約歷史 (AppointmentHistory): ${appointmentHistoryCount} 條記錄`);
    console.log(`排班 (Schedule): ${scheduleCount} 條記錄`);
    console.log(`房間 (Room): ${roomCount} 條記錄`);
    console.log(`醫生通知 (Notification): ${notificationCount} 條記錄`);
    console.log(`患者通知 (PatientNotification): ${patientNotificationCount} 條記錄`);
    console.log(`審計日誌 (AuditLog): ${auditLogCount} 條記錄`);

    // 驗證清理是否成功
    const totalCleanedRecords = appointmentCount + appointmentHistoryCount + 
                               scheduleCount + roomCount + notificationCount + 
                               patientNotificationCount + auditLogCount;

    console.log('\n=== 清理驗證結果 ===');
    if (totalCleanedRecords === 0) {
      console.log('✅ 清理成功！所有業務數據已被清除');
    } else {
      console.log(`❌ 清理不完整！仍有 ${totalCleanedRecords} 條業務數據記錄`);
    }

    if (userCount > 0) {
      console.log('✅ 用戶賬戶數據已保留');
    } else {
      console.log('❌ 警告：用戶賬戶數據也被清除了！');
    }

  } catch (error) {
    console.error('❌ 驗證過程中發生錯誤:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 執行驗證
verifyCleanup()
  .then(() => {
    console.log('\n驗證完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('驗證失敗:', error);
    process.exit(1);
  });