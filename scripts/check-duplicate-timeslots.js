const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const dateArg = process.argv[2];
  if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error('Usage: node scripts/check-duplicate-timeslots.js YYYY-MM-DD');
    process.exit(1);
  }

  try {
    const schedules = await prisma.schedule.findMany({
      where: { date: dateArg },
      include: {
        timeSlots: true,
        doctor: true,
        room: true,
      },
      orderBy: { date: 'asc' },
    });

    if (schedules.length === 0) {
      console.log(`[OK] No schedules found for ${dateArg}.`);
      return;
    }

    const dupBySchedule = [];
    const crossDupMap = new Map(); // key: doctorId|roomId|start|end -> { count, schedules: Set }

    for (const s of schedules) {
      const localMap = new Map(); // key: start|end -> count
      for (const ts of s.timeSlots) {
        const k = `${ts.startTime}|${ts.endTime}`;
        localMap.set(k, (localMap.get(k) || 0) + 1);
        const crossKey = `${s.doctorId}|${s.roomId}|${ts.startTime}|${ts.endTime}`;
        const prev = crossDupMap.get(crossKey) || { count: 0, schedules: new Set() };
        prev.count += 1;
        prev.schedules.add(s.id);
        crossDupMap.set(crossKey, prev);
      }
      for (const [k, cnt] of localMap.entries()) {
        if (cnt > 1) {
          const [start, end] = k.split('|');
          dupBySchedule.push({ scheduleId: s.id, doctorId: s.doctorId, roomId: s.roomId, start, end, count: cnt });
        }
      }
    }

    if (dupBySchedule.length === 0) {
      console.log(`[OK] No per-schedule duplicate timeslots found for ${dateArg}.`);
    } else {
      console.log(`[WARN] Per-schedule duplicate timeslots for ${dateArg}:`);
      for (const d of dupBySchedule) {
        console.log(`  schedule=${d.scheduleId} doctor=${d.doctorId} room=${d.roomId} ${d.start}-${d.end} x${d.count}`);
      }
    }

    const crossDup = [];
    for (const [crossKey, info] of crossDupMap.entries()) {
      if (info.count > info.schedules.size) {
        const [doctorId, roomId, start, end] = crossKey.split('|');
        crossDup.push({ doctorId, roomId, start, end, count: info.count, scheduleCount: info.schedules.size, scheduleIds: Array.from(info.schedules) });
      }
    }

    if (crossDup.length === 0) {
      console.log(`[OK] No cross-schedule duplicates for ${dateArg}.`);
    } else {
      console.log(`[WARN] Cross-schedule duplicate timeslots for ${dateArg}:`);
      for (const d of crossDup) {
        console.log(`  doctor=${d.doctorId} room=${d.roomId} ${d.start}-${d.end} total=${d.count} across ${d.scheduleCount} schedule(s): ${d.scheduleIds.join(',')}`);
      }
    }

  } catch (e) {
    console.error('Failed to check duplicates:', e);
    process.exitCode = 1;
  }
}

main();