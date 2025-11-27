const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run({ doctorName, date, month }) {
  try {
    const user = await prisma.user.findFirst({ where: { name: doctorName }, select: { id: true } });
    if (!user) {
      const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, select: { id: true, name: true } });
      console.log(`[NotFound] User with name ${doctorName}. Available doctors:`);
      for (const d of doctors) console.log(`- ${d.name} (${d.id})`);
      return;
    }
    const doctor = await prisma.doctor.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!doctor) {
      console.log(`[NotFound] Doctor profile for user ${user.id}`);
      return;
    }

    const rooms = await prisma.room.findMany({ where: { doctorId: doctor.id }, select: { id: true, name: true, bedCount: true } });
    const where = { doctorId: doctor.id };
    if (date) where.date = date;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      const start = new Date(y, (m || 1) - 1, 1);
      const next = new Date(y, (m || 1), 1);
      where.date = { gte: `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-01`, lt: `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-01` };
    }
    const schedules = await prisma.schedule.findMany({
      where,
      include: {
        room: { select: { id: true, name: true } },
        timeSlots: {
          where: { isActive: true },
          select: { id: true, startTime: true, endTime: true, bedCount: true, availableBeds: true },
          orderBy: { startTime: 'asc' },
        },
      },
      orderBy: { date: 'asc' },
    });

    if (!schedules.length) {
      console.log(`[Empty] No schedules for ${doctorName} on ${date}`);
      return;
    }

    const byRoom = new Map();
    for (const s of schedules) {
      const key = `${s.room.id}::${s.room.name}`;
      if (!byRoom.has(key)) byRoom.set(key, []);
      byRoom.get(key).push(s);
    }

    console.log(`Doctor: ${doctorName} (${doctor.id}) Date: ${date || '(month '+month+')'}`);
    console.log('Doctor Rooms:', rooms.map(r => `${r.name}(${r.id}) bedCount=${r.bedCount}`).join('; '));
    console.log(`Rooms used in schedules: ${byRoom.size}`);
    for (const [key, arr] of byRoom.entries()) {
      const [roomId, roomName] = key.split('::');
      const slots = arr.flatMap(s => s.timeSlots.map(t => `${t.startTime}-${t.endTime}`));
      const uniqSlots = Array.from(new Set(slots));
      console.log(`\nRoom ${roomName} (${roomId}) schedules=${arr.length} slots=${uniqSlots.length}`);
      console.log(`Slots: ${uniqSlots.join(', ')}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

const doctorName = process.argv[2] || '张茹';
const date = (/^\d{4}-\d{2}-\d{2}$/.test(process.argv[3]||'')) ? process.argv[3] : null;
const month = (/^\d{4}-\d{2}$/.test(process.argv[3]||'')) ? process.argv[3] : null;
run({ doctorName, date, month });