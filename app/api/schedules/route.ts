import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit';

const prisma = new PrismaClient();

interface TimeSlot {
  time: string;
  total: number;
  booked: number;
}

// GET dates with available slots for the logged-in doctor

// GET dates with available slots for the logged-in doctor
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');

  if (!month || !/\d{4}-\d{2}/.test(month)) {
    return NextResponse.json({ error: 'Month parameter in YYYY-MM format is required.' }, { status: 400 });
  }

  try {
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const startDate = `${month}-01`;
    const nextMonthDate = new Date(`${month}-01T00:00:00.000Z`);
    nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
    const endDate = nextMonthDate.toISOString().split('T')[0];

    const schedules = await prisma.schedule.findMany({
      where: {
        doctorId: doctorProfile.id,
        date: { gte: startDate, lt: endDate },
      },
      select: { date: true, timeSlots: true },
    });

    const availableDates = schedules
      .filter(s => {
        const timeSlots = s.timeSlots as TimeSlot[];
        return timeSlots.some(slot => slot.booked < slot.total);
      })
      .map(s => s.date);

    const distinctDates = [...new Set(availableDates)];

    return NextResponse.json({ scheduledDates: distinctDates });

  } catch (error) {
    console.error('Error fetching monthly schedule overview:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST a new single schedule entry (timeslot)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { doctorId, date, roomId, time, total } = await request.json();
    if (!doctorId || !date || !roomId || !time || total === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const newSchedule = await prisma.schedule.create({
      data: {
        doctorId,
        date,
        roomId,
        timeSlots: [{ time, total: Number(total), booked: 0 }],
      },
    });

    await createAuditLog(session, 'CREATE_SCHEDULE_TIMESLOT', 'Schedule', newSchedule.id, { date, time });
    return NextResponse.json(newSchedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) an existing schedule entry (timeslot)
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
    const { roomId, time, total } = await request.json();
    if (!roomId || !time || total === undefined) {
      return NextResponse.json({ error: 'roomId, time, and total are required' }, { status: 400 });
    }

    const updatedSchedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: { 
        roomId,
        timeSlots: [{ time, total: Number(total), booked: 0 }] // Assuming one timeslot per schedule entry now
      },
    });

    await createAuditLog(session, 'UPDATE_SCHEDULE_TIMESLOT', 'Schedule', updatedSchedule.id, { scheduleId });
    return NextResponse.json(updatedSchedule);
  } catch (error) {
    console.error('Error updating schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE a schedule entry (timeslot)
export async function DELETE(request: Request) {
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
    // Add authorization to ensure doctor owns this schedule
    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    const doctor = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (schedule?.doctorId !== doctor?.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.schedule.delete({ where: { id: scheduleId } });

    await createAuditLog(session, 'DELETE_SCHEDULE_TIMESLOT', 'Schedule', scheduleId);
    return NextResponse.json({ message: 'Schedule timeslot deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
