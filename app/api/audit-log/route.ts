import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';


// GET audit logs (Admin only) with pagination
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const pageParam = url.searchParams.get('page');
    const pageSizeParam = url.searchParams.get('pageSize') || url.searchParams.get('limit');

    // Basic pagination defaults and guards
    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeParam || '20', 10) || 20));
    const skip = (page - 1) * pageSize;

    const [total, logs] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    // Parse JSON details for frontend consumption
    const formattedLogs = logs.map(log => ({
      ...log,
      // @ts-expect-error Prisma's Json type is flexible, but we store stringified JSON
      details: log.details ? JSON.parse(log.details as string) : null,
    }));

    // Enrich with entityName for entities: User, Patient, Doctor, Room
    const collectIds = (type: string) => formattedLogs
      .filter(l => l.entityType === type && typeof l.entityId === 'string' && l.entityId)
      .map(l => l.entityId as string);

    const userIds = collectIds('User');
    const patientIds = collectIds('Patient');
    const doctorIds = collectIds('Doctor');
    const roomIds = collectIds('Room');
    const appointmentIds = collectIds('Appointment');
    const timeSlotIds = collectIds('TimeSlot');

    let userNameMap: Record<string, string> = {};
    let patientNameMap: Record<string, string> = {};
    let doctorNameMap: Record<string, string> = {};
    let roomNameMap: Record<string, string> = {};
    let appointmentSummaryMap: Record<string, string> = {};
    let timeSlotSummaryMap: Record<string, string> = {};

    if (userIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: Array.from(new Set(userIds)) } },
        select: { id: true, name: true },
      });
      userNameMap = users.reduce((acc, u) => { acc[u.id] = u.name ?? ''; return acc; }, {} as Record<string, string>);
    }

    if (patientIds.length > 0) {
      const patients = await prisma.patient.findMany({
        where: { id: { in: Array.from(new Set(patientIds)) } },
        include: { user: { select: { name: true } } },
      });
      patientNameMap = patients.reduce((acc, p) => { acc[p.id] = p.user?.name ?? ''; return acc; }, {} as Record<string, string>);
    }

    if (doctorIds.length > 0) {
      const doctors = await prisma.doctor.findMany({
        where: { id: { in: Array.from(new Set(doctorIds)) } },
        include: { user: { select: { name: true } } },
      });
      doctorNameMap = doctors.reduce((acc, d) => { acc[d.id] = d.user?.name ?? ''; return acc; }, {} as Record<string, string>);
    }

    if (roomIds.length > 0) {
      const rooms = await prisma.room.findMany({
        where: { id: { in: Array.from(new Set(roomIds)) } },
        select: { id: true, name: true },
      });
      roomNameMap = rooms.reduce((acc, r) => { acc[r.id] = r.name ?? ''; return acc; }, {} as Record<string, string>);
    }

    if (appointmentIds.length > 0) {
      const appointments = await prisma.appointment.findMany({
        where: { id: { in: Array.from(new Set(appointmentIds)) } },
        select: {
          id: true,
          schedule: { select: { date: true } },
          timeSlot: { select: { startTime: true, endTime: true } },
        },
      });
      appointmentSummaryMap = appointments.reduce((acc, a) => {
        const date = a.schedule?.date || '';
        const start = a.timeSlot?.startTime || '';
        const end = a.timeSlot?.endTime || '';
        const summary = [date, (start && end) ? `${start}-${end}` : start || end].filter(Boolean).join(' ');
        acc[a.id] = summary || a.id;
        return acc;
      }, {} as Record<string, string>);
    }

    if (timeSlotIds.length > 0) {
      const slots = await prisma.timeSlot.findMany({
        where: { id: { in: Array.from(new Set(timeSlotIds)) } },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          schedule: { select: { date: true } },
        },
      });
      timeSlotSummaryMap = slots.reduce((acc, s) => {
        const date = s.schedule?.date || '';
        const start = s.startTime || '';
        const end = s.endTime || '';
        const summary = [date, (start && end) ? `${start}-${end}` : start || end].filter(Boolean).join(' ');
        acc[s.id] = summary || s.id;
        return acc;
      }, {} as Record<string, string>);
    }

    const enrichedLogs = formattedLogs.map(log => {
      if (log.entityType === 'User' && log.entityId) {
        return { ...log, entityName: userNameMap[log.entityId as string] };
      }
      if (log.entityType === 'Patient' && log.entityId) {
        return { ...log, entityName: patientNameMap[log.entityId as string] };
      }
      if (log.entityType === 'Doctor' && log.entityId) {
        return { ...log, entityName: doctorNameMap[log.entityId as string] };
      }
      if (log.entityType === 'Room' && log.entityId) {
        return { ...log, entityName: roomNameMap[log.entityId as string] };
      }
      if (log.entityType === 'Appointment' && log.entityId) {
        return { ...log, entityName: appointmentSummaryMap[log.entityId as string] };
      }
      if (log.entityType === 'TimeSlot' && log.entityId) {
        return { ...log, entityName: timeSlotSummaryMap[log.entityId as string] };
      }
      return log;
    });

    return NextResponse.json({
      items: enrichedLogs,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
