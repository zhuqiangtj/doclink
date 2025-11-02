const { PrismaClient } = require('@prisma/client');

async function createTestAppointment() {
  const prisma = new PrismaClient();
  
  try {
    // 獲取第一個用戶和醫生
    const user = await prisma.user.findFirst({
      where: { role: 'PATIENT' },
      include: { patientProfile: true }
    });
    
    const doctor = await prisma.doctor.findFirst({
      include: { user: true }
    });
    
    const room = await prisma.room.findFirst();
    
    if (!user || !doctor || !room) {
      console.log('缺少必要的數據：用戶、醫生或房間');
      return;
    }
    
    // 創建明天的排程
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    // 查找或創建排程
    let schedule = await prisma.schedule.findFirst({
      where: {
        doctorId: doctor.id,
        date: tomorrowStr,
        roomId: room.id
      }
    });
    
    if (!schedule) {
      schedule = await prisma.schedule.create({
        data: {
          doctorId: doctor.id,
          date: tomorrowStr,
          roomId: room.id,
          timeSlots: ["09:00", "10:00", "11:00", "14:00", "15:00"]
        }
      });
    }
    
    // 創建測試預約
    const appointment = await prisma.appointment.create({
      data: {
        userId: user.id,
        patientId: user.patientProfile.id,
        doctorId: doctor.id,
        scheduleId: schedule.id,
        time: "10:00",
        roomId: room.id,
        bedId: 1,
        status: 'PENDING'
      }
    });
    
    console.log('成功創建測試預約：', {
      id: appointment.id,
      patient: user.name,
      doctor: doctor.user.name,
      date: tomorrowStr,
      time: appointment.time,
      status: appointment.status
    });
    
  } catch (error) {
    console.error('創建測試預約時發生錯誤：', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestAppointment();