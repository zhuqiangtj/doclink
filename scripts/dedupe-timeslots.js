const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const dateArg = process.argv[2];
  if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error('Usage: node scripts/dedupe-timeslots.js YYYY-MM-DD');
    process.exit(1);
  }

  try {
    const schedules = await prisma.schedule.findMany({
      where: { date: dateArg },
      include: { timeSlots: true },
      orderBy: { date: 'asc' },
    });

    if (schedules.length === 0) {
      console.log(`[OK] No schedules found for ${dateArg}. Nothing to dedupe.`);
      return;
    }

    let totalDeleted = 0;
    for (const s of schedules) {
      const groups = new Map(); // key: start|end -> [timeslot]
      for (const ts of s.timeSlots) {
        const k = `${ts.startTime}|${ts.endTime}`;
        const arr = groups.get(k) || [];
        arr.push(ts);
        groups.set(k, arr);
      }

      for (const [key, dups] of groups.entries()) {
        if (dups.length <= 1) continue;
        const [start, end] = key.split('|');
        console.log(`[INFO] schedule=${s.id} ${start}-${end} has ${dups.length} duplicates`);

        // compute non-cancelled appointment counts
        const withCounts = [];
        for (const ts of dups) {
          const nonCancelled = await prisma.appointment.count({
            where: { timeSlotId: ts.id, status: { not: 'CANCELLED' } },
          });
          const cancelledList = await prisma.appointment.findMany({
            where: { timeSlotId: ts.id, status: 'CANCELLED' },
            select: { id: true },
          });
          withCounts.push({ ts, nonCancelled, cancelledIds: cancelledList.map(a => a.id) });
        }

        // Keep the one with highest nonCancelled count. If tie, keep the first.
        const sorted = withCounts.sort((a, b) => b.nonCancelled - a.nonCancelled);
        const keeper = sorted[0];
        const toDelete = sorted.slice(1);

        // Only delete duplicates that have zero non-cancelled appointments.
        for (const item of toDelete) {
          if (item.nonCancelled > 0) {
            console.warn(`[SKIP] timeslot=${item.ts.id} has ${item.nonCancelled} active appointments; manual review required`);
            continue;
          }
          // Clean cancelled appointments and histories first
          if (item.cancelledIds.length > 0) {
            await prisma.appointmentHistory.deleteMany({ where: { appointmentId: { in: item.cancelledIds } } });
            await prisma.appointment.deleteMany({ where: { id: { in: item.cancelledIds } } });
          }
          await prisma.timeSlot.delete({ where: { id: item.ts.id } });
          totalDeleted += 1;
          console.log(`[DELETED] timeslot=${item.ts.id} (${start}-${end})`);
        }
      }
    }

    console.log(`[DONE] Deleted ${totalDeleted} duplicate timeslots for ${dateArg}.`);
  } catch (e) {
    console.error('Failed to dedupe timeslots:', e);
    process.exitCode = 1;
  }
}

main();