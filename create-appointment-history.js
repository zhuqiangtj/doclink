const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createAppointmentHistory() {
  try {
    console.log('=== 創建預約歷史記錄 ===');
    
    // 獲取第一個預約
    const appointment = await prisma.appointment.findFirst({
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } }
      }
    });
    
    if (!appointment) {
      console.log('沒有找到預約');
      return;
    }
    
    console.log('為預約創建歷史記錄:', appointment.id);
    console.log('患者:', appointment.patient.user.name);
    console.log('醫生:', appointment.doctor.user.name);
    
    // 創建多個歷史記錄來模擬預約的生命週期
    const historyRecords = [
      {
        appointmentId: appointment.id,
        operatorName: '系統',
        operatorId: null,
        status: 'PENDING',
        reason: null,
        action: 'CREATE'
      },
      {
        appointmentId: appointment.id,
        operatorName: appointment.patient.user.name,
        operatorId: appointment.patient.userId,
        status: 'PENDING',
        reason: null,
        action: 'CHECKIN'
      },
      {
        appointmentId: appointment.id,
        operatorName: appointment.doctor.user.name,
        operatorId: appointment.doctor.userId,
        status: 'COMPLETED',
        reason: '正常就診完成',
        action: 'UPDATE_STATUS_TO_COMPLETED'
      }
    ];
    
    // 創建歷史記錄
    for (let i = 0; i < historyRecords.length; i++) {
      const record = historyRecords[i];
      
      // 添加時間延遲以模擬真實的時間順序
      const operatedAt = new Date();
      operatedAt.setMinutes(operatedAt.getMinutes() - (historyRecords.length - i) * 30);
      
      const history = await prisma.appointmentHistory.create({
        data: {
          ...record,
          operatedAt
        }
      });
      
      console.log(`創建歷史記錄 ${i + 1}:`, {
        id: history.id,
        action: history.action,
        operatorName: history.operatorName,
        status: history.status,
        operatedAt: history.operatedAt
      });
    }
    
    // 更新預約狀態為最終狀態
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { 
        status: 'COMPLETED',
        reason: '正常就診完成'
      }
    });
    
    console.log('預約狀態已更新為 COMPLETED');
    
    // 驗證歷史記錄
    const allHistory = await prisma.appointmentHistory.findMany({
      where: { appointmentId: appointment.id },
      orderBy: { operatedAt: 'asc' }
    });
    
    console.log('\n=== 驗證歷史記錄 ===');
    console.log(`總共創建了 ${allHistory.length} 條歷史記錄`);
    
    allHistory.forEach((record, index) => {
      console.log(`記錄 ${index + 1}:`, {
        操作: record.action,
        操作人: record.operatorName,
        狀態: record.status,
        原因: record.reason,
        時間: record.operatedAt.toLocaleString('zh-TW')
      });
    });
    
  } catch (error) {
    console.error('創建歷史記錄時發生錯誤:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAppointmentHistory();