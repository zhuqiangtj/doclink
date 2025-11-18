const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

function loadEnv() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (e) {
    console.error('Failed to load .env:', e.message);
  }
}

async function main() {
  loadEnv();
  const prisma = new PrismaClient();
  const uname = 'zhangru';

  let user = await prisma.user.findUnique({ where: { username: uname } });
  if (!user) {
    const hashed = await bcrypt.hash('123456', 10);
    user = await prisma.user.create({
      data: { username: uname, password: hashed, name: '张如医生', role: 'DOCTOR' }
    });
  } else {
    const hashed = await bcrypt.hash('123456', 10);
    user = await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, role: 'DOCTOR', name: user.name || '张如医生' }
    });
  }

  let doctor = await prisma.doctor.findUnique({ where: { userId: user.id } });
  if (!doctor) {
    doctor = await prisma.doctor.create({ data: { userId: user.id } });
  }

  let room = await prisma.room.findFirst({ where: { doctorId: doctor.id } });
  if (!room) {
    room = await prisma.room.create({ data: { name: '一诊室', bedCount: 10, doctorId: doctor.id } });
  }

  const date = '2025-11-18';
  let schedule = await prisma.schedule.findFirst({ where: { date, roomId: room.id, doctorId: doctor.id } });
  if (!schedule) {
    schedule = await prisma.schedule.create({ data: { date, roomId: room.id, doctorId: doctor.id } });
  }

  const slots = [
    { startTime: '09:00', endTime: '10:00', bedCount: 5, availableBeds: 5, type: 'MORNING', isActive: true },
    { startTime: '10:00', endTime: '11:00', bedCount: 8, availableBeds: 8, type: 'MORNING', isActive: true },
    { startTime: '14:00', endTime: '15:00', bedCount: 6, availableBeds: 6, type: 'AFTERNOON', isActive: true },
  ];

  for (const s of slots) {
    const ex = await prisma.timeSlot.findFirst({
      where: { scheduleId: schedule.id, startTime: s.startTime, endTime: s.endTime }
    });
    if (!ex) {
      await prisma.timeSlot.create({ data: { ...s, scheduleId: schedule.id } });
    }
  }

  console.log(JSON.stringify({ doctorId: doctor.id, roomId: room.id, scheduleId: schedule.id }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});