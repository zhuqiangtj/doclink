const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createZhangruSchedule() {
  try {
    const user = await prisma.user.findUnique({ where: { username: 'zhangru' } });
    if (!user) {
      console.log('用戶 zhangru 不存在，請先執行 recreate-zhangru-user.js');
      return;
    }

    let doctor = await prisma.doctor.findUnique({ where: { userId: user.id }, include: { Room: true } });
    if (!doctor) {
      doctor = await prisma.doctor.create({ data: { userId: user.id } });
      console.log('已創建醫生資料:', doctor.id);
    }

    let room = doctor.Room && doctor.Room.length > 0 ? doctor.Room[0] : null;
    if (!room) {
      room = await prisma.room.create({
        data: {
          name: '一診室',
          bedCount: 10,
          doctorId: doctor.id,
        },
      });
      console.log('已創建診室:', room.id);
    }

    const today = new Date().toISOString().split('T')[0];
    let schedule = await prisma.schedule.findFirst({ where: { date: today, roomId: room.id, doctorId: doctor.id } });
    if (!schedule) {
      schedule = await prisma.schedule.create({ data: { date: today, roomId: room.id, doctorId: doctor.id } });
      console.log('已創建今日排程:', schedule.id);
    }

    const timeSlots = [
      { startTime: '09:00', endTime: '10:00', bedCount: 5, availableBeds: 5, type: 'MORNING', isActive: true },
      { startTime: '10:00', endTime: '11:00', bedCount: 8, availableBeds: 8, type: 'MORNING', isActive: true },
      { startTime: '14:00', endTime: '15:00', bedCount: 6, availableBeds: 6, type: 'AFTERNOON', isActive: true },
    ];

    for (const slot of timeSlots) {
      const existing = await prisma.timeSlot.findFirst({
        where: { scheduleId: schedule.id, startTime: slot.startTime, endTime: slot.endTime },
      });
      if (!existing) {
        await prisma.timeSlot.create({ data: { ...slot, scheduleId: schedule.id } });
        console.log(`已創建時段: ${slot.startTime}-${slot.endTime}`);
      } else {
        console.log(`時段已存在: ${slot.startTime}-${slot.endTime}`);
      }
    }

    const final = await prisma.schedule.findUnique({
      where: { id: schedule.id },
      include: { room: true, timeSlots: true },
    });
    console.log('\nZhangru 今日排程:');
    console.log(JSON.stringify(final, null, 2));
  } catch (e) {
    console.error('錯誤:', e);
  } finally {
    await prisma.$disconnect();
  }
}

createZhangruSchedule();