const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkZhangruSchedules() {
  try {
    const user = await prisma.user.findUnique({ where: { username: 'zhangru' } });
    if (!user) {
      console.log('用戶 zhangru 不存在');
      return;
    }

    const doctor = await prisma.doctor.findUnique({ where: { userId: user.id } });
    if (!doctor) {
      console.log('未找到醫生資料 for zhangru');
      return;
    }

    const dates = ['2024-11-06', '2025-11-06'];
    const result = {};

    for (const date of dates) {
      const schedules = await prisma.schedule.findMany({
        where: { doctorId: doctor.id, date },
        include: { room: true, timeSlots: true }
      });
      result[date] = schedules.map(s => ({
        id: s.id,
        date: s.date,
        room: s.room?.name,
        timeSlots: s.timeSlots.map(ts => ({
          id: ts.id,
          startTime: ts.startTime,
          endTime: ts.endTime,
          bedCount: ts.bedCount,
          availableBeds: ts.availableBeds,
          type: ts.type,
          isActive: ts.isActive
        }))
      }));
    }

    console.log(JSON.stringify({ doctorId: doctor.id, doctorUserId: doctor.userId, result }, null, 2));
  } catch (e) {
    console.error('錯誤:', e);
  } finally {
    await prisma.$disconnect();
  }
}

checkZhangruSchedules();