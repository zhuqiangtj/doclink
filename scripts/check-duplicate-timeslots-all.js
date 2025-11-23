const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const schedules = await prisma.schedule.findMany({
      include: { timeSlots: true },
      orderBy: { date: 'asc' },
    });
    const dupItems = [];
    for (const s of schedules) {
      const map = new Map();
      for (const ts of s.timeSlots) {
        const k = `${ts.startTime}|${ts.endTime}`;
        map.set(k, (map.get(k) || 0) + 1);
      }
      for (const [k, cnt] of map.entries()) {
        if (cnt > 1) {
          const [start, end] = k.split('|');
          dupItems.push({ date: s.date, scheduleId: s.id, doctorId: s.doctorId, roomId: s.roomId, start, end, count: cnt });
        }
      }
    }
    if (dupItems.length === 0) {
      console.log('[OK] No duplicates across all schedules.');
    } else {
      console.log(`[WARN] Found ${dupItems.length} duplicate time slots across schedules:`);
      for (const d of dupItems) {
        console.log(`  date=${d.date} schedule=${d.scheduleId} doctor=${d.doctorId} room=${d.roomId} ${d.start}-${d.end} x${d.count}`);
      }
    }
  } catch (e) {
    console.error('Failed to check duplicates across all schedules:', e);
    process.exitCode = 1;
  }
}

main();