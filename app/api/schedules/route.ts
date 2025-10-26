import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit';

const prisma = new PrismaClient();

// GET monthly schedule overview for the logged-in doctor
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month'); // e.g., "2025-11"

  if (!month || !/\d{4}-\d{2}/.test(month)) {
    return NextResponse.json({ error: 'Month parameter in YYYY-MM format is required.' }, { status: 400 });
  }

  try {
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const startDate = new Date(`${month}-01`);
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);

    const schedules = await prisma.schedule.findMany({
      where: {
        doctorId: doctorProfile.id,
        date: {
          gte: startDate.toISOString().split('T')[0],
          lt: endDate.toISOString().split('T')[0],
        },
      },
      select: {
        date: true,
      },
      distinct: ['date'],
    });

    const scheduledDates = schedules.map(s => s.date);

    return NextResponse.json({ scheduledDates });

  } catch (error) {
    console.error('Error fetching monthly schedule overview:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST a new schedule for the logged-in doctor
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { doctorId, date, roomId, timeSlots } = await request.json();

    if (!doctorId || !date || !roomId || !timeSlots) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const newSchedule = await prisma.schedule.create({
      data: {
        doctorId,
        date,
        roomId,
        timeSlots,
      },
    });

    await createAuditLog(session, 'CREATE_SCHEDULE', 'Schedule', newSchedule.id, { date, roomId });
    return NextResponse.json(newSchedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) an existing schedule
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scheduleId = searchParams.get('scheduleId');
  if (!scheduleId) {
    return NextResponse.json({ error: 'Schedule ID is required' }, { status: 400 });
  }

  try {
    const { timeSlots } = await request.json();
    if (!timeSlots) {
      return NextResponse.json({ error: 'timeSlots are required for update' }, { status: 400 });
    }

    const updatedSchedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: { timeSlots },
    });

    await createAuditLog(session, 'UPDATE_SCHEDULE', 'Schedule', updatedSchedule.id, { scheduleId });
    return NextResponse.json(updatedSchedule);
  } catch (error) {
    console.error('Error updating schedule:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}