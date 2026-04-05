const { PrismaClient } = require('@prisma/client');
const OpenCC = require('opencc-js');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

const convert = OpenCC.Converter({ from: 'hk', to: 'cn' });
const BATCH_SIZE = 100;

function toSimplified(value) {
  if (typeof value !== 'string' || !value) return value;
  return convert(value);
}

function changedString(value) {
  return typeof value === 'string' && value.length > 0 && toSimplified(value) !== value;
}

function convertJsonValue(value) {
  if (typeof value === 'string') {
    return toSimplified(value);
  }
  if (Array.isArray(value)) {
    return value.map(convertJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, convertJsonValue(nestedValue)])
    );
  }
  return value;
}

function jsonChanged(value) {
  if (value === null || typeof value === 'undefined') return false;
  const converted = convertJsonValue(value);
  return JSON.stringify(converted) !== JSON.stringify(value);
}

async function runInBatches(items, worker) {
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const batch = items.slice(index, index + BATCH_SIZE);
    await Promise.all(batch.map((item) => worker(item)));
  }
}

async function updateUsers(summary) {
  const rows = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
    },
  });

  const targets = rows.filter((row) => toSimplified(row.name) !== row.name);

  await runInBatches(targets, async (row) => {
    const nextName = toSimplified(row.name);

    await prisma.user.update({
      where: { id: row.id },
      data: { name: nextName },
    });
    summary.User += 1;
  });
}

async function updateRooms(summary) {
  const rows = await prisma.room.findMany({
    select: {
      id: true,
      name: true,
    },
  });

  const targets = rows.filter((row) => toSimplified(row.name) !== row.name);

  await runInBatches(targets, async (row) => {
    const nextName = toSimplified(row.name);

    await prisma.room.update({
      where: { id: row.id },
      data: { name: nextName },
    });
    summary.Room += 1;
  });
}

async function updateAppointments(summary) {
  const rows = await prisma.appointment.findMany({
    select: {
      id: true,
      reason: true,
      symptoms: true,
      treatmentPlan: true,
    },
  });

  const targets = rows
    .map((row) => {
      const data = {};

      if (changedString(row.reason)) data.reason = toSimplified(row.reason);
      if (changedString(row.symptoms)) data.symptoms = toSimplified(row.symptoms);
      if (changedString(row.treatmentPlan)) {
        data.treatmentPlan = toSimplified(row.treatmentPlan);
      }

      if (Object.keys(data).length === 0) return null;
      return { id: row.id, data };
    })
    .filter(Boolean);

  await runInBatches(targets, async (row) => {
    await prisma.appointment.update({
      where: { id: row.id },
      data: row.data,
    });
    summary.Appointment += 1;
  });
}

async function updateAppointmentHistory(summary) {
  const rows = await prisma.appointmentHistory.findMany({
    select: {
      id: true,
      operatorName: true,
      reason: true,
      action: true,
    },
  });

  const targets = rows
    .map((row) => {
      const data = {};

      if (changedString(row.operatorName)) {
        data.operatorName = toSimplified(row.operatorName);
      }
      if (changedString(row.reason)) data.reason = toSimplified(row.reason);
      if (changedString(row.action)) data.action = toSimplified(row.action);

      if (Object.keys(data).length === 0) return null;
      return { id: row.id, data };
    })
    .filter(Boolean);

  await runInBatches(targets, async (row) => {
    await prisma.appointmentHistory.update({
      where: { id: row.id },
      data: row.data,
    });
    summary.AppointmentHistory += 1;
  });
}

async function updateNotifications(summary) {
  const rows = await prisma.notification.findMany({
    select: {
      id: true,
      patientName: true,
      message: true,
      type: true,
    },
  });

  const targets = rows
    .map((row) => {
      const data = {};

      if (changedString(row.patientName)) {
        data.patientName = toSimplified(row.patientName);
      }
      if (changedString(row.message)) data.message = toSimplified(row.message);
      if (changedString(row.type)) data.type = toSimplified(row.type);

      if (Object.keys(data).length === 0) return null;
      return { id: row.id, data };
    })
    .filter(Boolean);

  await runInBatches(targets, async (row) => {
    await prisma.notification.update({
      where: { id: row.id },
      data: row.data,
    });
    summary.Notification += 1;
  });
}

async function updatePatientNotifications(summary) {
  const rows = await prisma.patientNotification.findMany({
    select: {
      id: true,
      doctorName: true,
      message: true,
      type: true,
    },
  });

  const targets = rows
    .map((row) => {
      const data = {};

      if (changedString(row.doctorName)) {
        data.doctorName = toSimplified(row.doctorName);
      }
      if (changedString(row.message)) data.message = toSimplified(row.message);
      if (changedString(row.type)) data.type = toSimplified(row.type);

      if (Object.keys(data).length === 0) return null;
      return { id: row.id, data };
    })
    .filter(Boolean);

  await runInBatches(targets, async (row) => {
    await prisma.patientNotification.update({
      where: { id: row.id },
      data: row.data,
    });
    summary.PatientNotification += 1;
  });
}

async function updateAuditLogs(summary) {
  const rows = await prisma.auditLog.findMany({
    select: {
      id: true,
      userName: true,
      details: true,
    },
  });

  const targets = rows
    .map((row) => {
      const data = {};

      if (changedString(row.userName)) data.userName = toSimplified(row.userName);
      if (jsonChanged(row.details)) data.details = convertJsonValue(row.details);

      if (Object.keys(data).length === 0) return null;
      return { id: row.id, data };
    })
    .filter(Boolean);

  await runInBatches(targets, async (row) => {
    await prisma.auditLog.update({
      where: { id: row.id },
      data: row.data,
    });
    summary.AuditLog += 1;
  });
}

async function main() {
  const summary = {
    User: 0,
    Room: 0,
    Appointment: 0,
    AppointmentHistory: 0,
    Notification: 0,
    PatientNotification: 0,
    AuditLog: 0,
  };

  console.log('[START] Converting existing Traditional Chinese data to Simplified Chinese...');

  await updateUsers(summary);
  await updateRooms(summary);
  await updateAppointments(summary);
  await updateAppointmentHistory(summary);
  await updateNotifications(summary);
  await updatePatientNotifications(summary);
  await updateAuditLogs(summary);

  const totalRows = Object.values(summary).reduce((sum, count) => sum + count, 0);

  console.log('[DONE] Conversion finished.');
  console.log(JSON.stringify({ totalRowsUpdated: totalRows, summary }, null, 2));
}

main()
  .catch((error) => {
    console.error('[ERROR] Failed to convert database contents:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
