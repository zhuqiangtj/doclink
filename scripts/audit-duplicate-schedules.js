const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const schedules = await prisma.schedule.findMany({
      include: {
        room: { select: { id: true, name: true } },
        doctor: { include: { user: { select: { id: true, name: true } } } },
        _count: { select: { timeSlots: true } },
      },
      orderBy: { date: 'asc' },
    });

    const groups = new Map();
    for (const s of schedules) {
      const key = `${s.doctorId}::${s.date}::${s.roomId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    const duplicates = [];
    for (const [key, arr] of groups.entries()) {
      if (arr.length > 1) {
        const [doctorId, date, roomId] = key.split('::');
        const roomName = arr[0].room?.name;
        const doctorName = arr[0].doctor?.user?.name;
        duplicates.push({ doctorId, doctorName, date, roomId, roomName, count: arr.length, schedules: arr.map(x => ({ id: x.id, timeSlots: x._count?.timeSlots || 0 })) });
      }
    }

    if (duplicates.length === 0) {
      console.log('[OK] No duplicate schedules found (by doctorId+date+roomId).');
    } else {
      console.log(`[WARN] Found ${duplicates.length} duplicate groups.`);
      for (const d of duplicates) {
        console.log(`Doctor: ${d.doctorName}(${d.doctorId}) Date: ${d.date} Room: ${d.roomName}(${d.roomId}) -> ${d.count} schedules`);
        console.log('  Schedules:', d.schedules.map(s => `${s.id}(slots=${s.timeSlots})`).join(', '));
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();