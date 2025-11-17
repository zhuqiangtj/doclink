const { PrismaClient } = require('@prisma/client');
const http = require('http');

function toYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port ? Number(urlObj.port) : 80,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      };

      const req = http.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode, data: json });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      });
      req.on('error', reject);
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function ensureScheduleAndSlotForDate(prisma, doctor, dateStr) {
  const room = await prisma.room.findFirst({ where: { doctorId: doctor.id } });
  if (!room) throw new Error('医生没有可用诊室');

  let schedule = await prisma.schedule.findFirst({
    where: { doctorId: doctor.id, date: dateStr, roomId: room.id },
    include: { timeSlots: true },
  });

  if (!schedule) {
    schedule = await prisma.schedule.create({
      data: { doctorId: doctor.id, date: dateStr, roomId: room.id },
      include: { timeSlots: true },
    });
    console.log(`✓ 已创建指定日期排程 ${schedule.id} (${dateStr})`);
  }

  const DEFAULT_SLOTS = [
    { startTime: '09:00', endTime: '10:00', bedCount: 4, type: 'MORNING' },
    { startTime: '10:00', endTime: '11:00', bedCount: 4, type: 'MORNING' },
    { startTime: '14:00', endTime: '15:00', bedCount: 4, type: 'AFTERNOON' },
    { startTime: '15:00', endTime: '16:00', bedCount: 3, type: 'AFTERNOON' },
  ];

  for (const tpl of DEFAULT_SLOTS) {
    const exists = await prisma.timeSlot.findFirst({
      where: { scheduleId: schedule.id, startTime: tpl.startTime, endTime: tpl.endTime },
    });
    if (exists) continue;
    const created = await prisma.timeSlot.create({
      data: {
        scheduleId: schedule.id,
        startTime: tpl.startTime,
        endTime: tpl.endTime,
        bedCount: Math.min(tpl.bedCount, room.bedCount),
        availableBeds: Math.min(tpl.bedCount, room.bedCount),
        type: tpl.type,
        isActive: true,
      },
    });
    console.log(`✓ 已创建时段 ${created.startTime}-${created.endTime}`);
  }

  schedule = await prisma.schedule.findUnique({
    where: { id: schedule.id },
    include: { timeSlots: true },
  });

  const candidate = schedule.timeSlots
    .filter(s => s.isActive && s.availableBeds > 0)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0] || null;
  if (!candidate) throw new Error(`${dateStr} 没有可预约的时段`);

  return { schedule, room, slot: candidate };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('=== 模拟患者端预约（事务递减床位）===');

    const patientUser = await prisma.user.findFirst({ where: { role: 'PATIENT' }, include: { patientProfile: true } });
    if (!patientUser || !patientUser.patientProfile) throw new Error('找不到患者用户');

    const doctorUser = await prisma.user.findUnique({ where: { username: 'zhangru' }, include: { doctorProfile: true } });
    if (!doctorUser?.doctorProfile) throw new Error('找不到医生');
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorUser.doctorProfile.id }, include: { user: true } });

    const targetDate = '2025-11-18';
    const { schedule, room, slot: initialSlot } = await ensureScheduleAndSlotForDate(prisma, doctor, targetDate);
    // Prefer booking a specific start time if available (e.g., to validate gray->blue transition)
    const preferredStart = process.env.PREFERRED_START || '09:00';
    let slot = initialSlot;
    try {
      const specific = await prisma.timeSlot.findFirst({
        where: { scheduleId: schedule.id, startTime: preferredStart, isActive: true, availableBeds: { gt: 0 } }
      });
      if (specific) slot = specific;
    } catch {}

    console.log(`准备预约：医生=${doctor.user?.name} 日期=${schedule.date} 房间=${room.name} 时段=${slot.startTime}-${slot.endTime} 余=${slot.availableBeds}`);

    // Transaction: atomic decrement and create appointment
  const appointment = await prisma.$transaction(async (tx) => {
      const dec = await tx.timeSlot.updateMany({
        where: { id: slot.id, availableBeds: { gt: 0 }, isActive: true },
        data: { availableBeds: { decrement: 1 } },
      });
      if (dec.count === 0) throw new Error('该时段已满');

      const apt = await tx.appointment.create({
        data: {
          userId: patientUser.id,
          patientId: patientUser.patientProfile.id,
          doctorId: doctor.id,
          scheduleId: schedule.id,
          timeSlotId: slot.id,
          time: slot.startTime,
          roomId: room.id,
          bedId: 0,
          status: 'PENDING',
          reason: '患者脚本预约',
        },
      });
      return apt;
    });

  console.log('✓ 预约已创建：', {
      appointmentId: appointment.id,
      doctorId: doctor.id,
      patientId: patientUser.patientProfile.id,
      scheduleId: schedule.id,
      timeSlotId: slot.id,
      startTime: slot.startTime,
  });
  const createdTs = Date.now();
  console.log('createdTs', createdTs);

    const verify = await prisma.appointment.findMany({
      where: { scheduleId: schedule.id },
      select: { id: true, timeSlotId: true, status: true }
    });
    console.log('当前该日期的预约记录数:', verify.length, verify);

    // Publish doctor event to file store to trigger SSE refresh in dev
    const base = process.env.BASE_URL || 'http://localhost:3001';
    const payload = encodeURIComponent(JSON.stringify({
      appointmentId: appointment.id,
      scheduleId: schedule.id,
      timeSlotId: slot.id,
      date: schedule.date,
      startTime: slot.startTime,
      roomId: room.id,
    }));
    const publishUrl = `${base}/api/debug/publish?kind=doctor&id=${doctor.id}&type=APPOINTMENT_CREATED&store=file&payload=${payload}`;
    const publishTs = Date.now();
    console.log('publishTs', publishTs);
    const pubRes = await makeRequest(publishUrl);
    console.log('事件发布结果:', pubRes);

    console.log('=== 完成 ===');
  } catch (e) {
    console.error('❌ 预约模拟失败：', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}