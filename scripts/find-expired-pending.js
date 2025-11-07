// scripts/find-expired-pending.js
// 查找所有「已過期但仍為待就診(PENDING)」的預約，輸出關鍵信息用於排查

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getTodayAndTimeByTZ() {
  const now = new Date();
  const tz = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Taipei';

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const currentTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  return { tz, today, currentTime };
}

async function main() {
  const { tz, today, currentTime } = getTodayAndTimeByTZ();
  console.log(`[find-expired-pending] tz=${tz}, today=${today}, time=${currentTime}`);

  const expiredPending = await prisma.appointment.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { schedule: { date: { lt: today } } },
        { schedule: { date: today }, timeSlot: { startTime: { lt: currentTime } } },
      ],
    },
    include: {
      schedule: true,
      timeSlot: true,
      patient: { include: { user: true } },
      doctor: { include: { user: true } },
    },
  });

  console.log(`Found ${expiredPending.length} expired & still PENDING appointments.`);
  for (const appt of expiredPending) {
    console.log({
      id: appt.id,
      date: appt.schedule?.date,
      startTime: appt.timeSlot?.startTime,
      status: appt.status,
      patientName: appt.patient?.user?.name,
      doctorName: appt.doctor?.user?.name,
      roomId: appt.roomId,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });