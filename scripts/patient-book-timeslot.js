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

async function ensureTodayScheduleAndSlot(prisma, doctor) {
  // pick first room
  const room = await prisma.room.findFirst({ where: { doctorId: doctor.id } });
  if (!room) throw new Error('医生没有可用诊室');

  const todayStr = toYYYYMMDD(new Date());
  let schedule = await prisma.schedule.findFirst({
    where: { doctorId: doctor.id, date: todayStr, roomId: room.id },
    include: { timeSlots: true },
  });

  if (!schedule) {
    schedule = await prisma.schedule.create({
      data: { doctorId: doctor.id, date: todayStr, roomId: room.id },
      include: { timeSlots: true },
    });
    console.log(`✓ 已创建今天排程 ${schedule.id}`);
  }

  // default slots (avoid past starts)
  const DEFAULT_SLOTS = [
    { startTime: '09:00', endTime: '10:00', bedCount: 4, type: 'MORNING' },
    { startTime: '10:00', endTime: '11:00', bedCount: 4, type: 'MORNING' },
    { startTime: '14:00', endTime: '15:00', bedCount: 4, type: 'AFTERNOON' },
    { startTime: '15:00', endTime: '16:00', bedCount: 3, type: 'AFTERNOON' },
  ];

  const now = new Date();
  for (const tpl of DEFAULT_SLOTS) {
    // skip if exists
    const exists = await prisma.timeSlot.findFirst({
      where: { scheduleId: schedule.id, startTime: tpl.startTime, endTime: tpl.endTime },
    });
    if (exists) continue;

    const [yy, mm, dd] = schedule.date.split('-').map(Number);
    const [hh, mi] = tpl.startTime.split(':').map(Number);
    const start = new Date(yy, (mm || 1) - 1, dd || 1, hh || 0, mi || 0, 0, 0);
    if (start.getTime() <= now.getTime()) continue; // avoid past starts

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

  // reload with slots
  schedule = await prisma.schedule.findUnique({
    where: { id: schedule.id },
    include: { timeSlots: true },
  });

  // pick an available future slot
  let candidate = null;
  for (const slot of schedule.timeSlots.sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    if (!slot.isActive || slot.availableBeds <= 0) continue;
    const [yy, mm, dd] = schedule.date.split('-').map(Number);
    const [hh, mi] = slot.startTime.split(':').map(Number);
    const start = new Date(yy, (mm || 1) - 1, dd || 1, hh || 0, mi || 0, 0, 0);
    if (start.getTime() > now.getTime()) { candidate = slot; break; }
  }
  if (!candidate) throw new Error('今天没有可预约的未来时段');

  return { schedule, room, slot: candidate };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('=== 模拟患者端预约（事务递减床位）===');

    const patientUser = await prisma.user.findFirst({ where: { role: 'PATIENT' }, include: { patientProfile: true } });
    if (!patientUser || !patientUser.patientProfile) throw new Error('找不到患者用户');

    const doctor = await prisma.doctor.findFirst({ include: { user: true } });
    if (!doctor) throw new Error('找不到医生');

    const { schedule, room, slot } = await ensureTodayScheduleAndSlot(prisma, doctor);

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

    // Publish doctor event to file store to trigger SSE refresh in dev
    const publishUrl = `http://localhost:3002/api/debug/publish?kind=doctor&id=${doctor.id}&type=APPOINTMENT_CREATED&store=file`;
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