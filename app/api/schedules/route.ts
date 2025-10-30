import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit';

const prisma = new PrismaClient();

interface Appointment {
  id: string;
  patient: { name: string };
  status: string;
  time: string;
}

interface TimeSlot {
  time: string;
  total: number;
  booked: number;
  appointments: Appointment[];
}

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

// POST a new timeslot to a schedule
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { date, roomId, time, total } = await request.json();
    if (!date || !roomId || !time || total === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    let schedule = await prisma.schedule.findFirst({
      where: { date, doctorId: doctorProfile.id, roomId },
    });

    if (schedule) {
      const timeSlots = schedule.timeSlots as TimeSlot[];
      timeSlots.push({ time, total: Number(total), booked: 0, appointments: [] });
      schedule = await prisma.schedule.update({
        where: { id: schedule.id },
        data: { timeSlots },
      });
    } else {
      schedule = await prisma.schedule.create({
        data: {
          doctorId: doctorProfile.id,
          date,
          roomId,
          timeSlots: [{ time, total: Number(total), booked: 0, appointments: [] }],
        },
      });
    }

    await createAuditLog(session, 'CREATE_SCHEDULE_TIMESLOT', 'Schedule', schedule.id, { date, time });
    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) an existing timeslot in a schedule
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scheduleId = searchParams.get('scheduleId');
  const originalTime = searchParams.get('time');
  if (!scheduleId || !originalTime) {
    return NextResponse.json({ error: 'Schedule ID and original time are required' }, { status: 400 });
  }

  try {
    const { roomId, time, total } = await request.json();
    if (!roomId || !time || total === undefined) {
      return NextResponse.json({ error: 'roomId, time, and total are required' }, { status: 400 });
    }

    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const scheduleToUpdate = await prisma.schedule.findFirst({
      where: { id: scheduleId, doctorId: doctorProfile.id },
    });

    if (!scheduleToUpdate) {
      return NextResponse.json({ error: 'Schedule not found or you do not have permission to update it.' }, { status: 404 });
    }

    const timeSlots = scheduleToUpdate.timeSlots as TimeSlot[];
    const timeSlotIndex = timeSlots.findIndex(slot => slot.time === originalTime);

    if (timeSlotIndex === -1) {
      return NextResponse.json({ error: 'Timeslot not found' }, { status: 404 });
    }

    timeSlots[timeSlotIndex] = { ...timeSlots[timeSlotIndex], time, total: Number(total) };

    const updatedSchedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: { roomId, timeSlots },
    });

    await createAuditLog(session, 'UPDATE_SCHEDULE_TIMESLOT', 'Schedule', updatedSchedule.id, { scheduleId });
    return NextResponse.json(updatedSchedule);
  } catch (error) {
    console.error('Error updating schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE a timeslot from a schedule
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scheduleId = searchParams.get('scheduleId');
  const time = searchParams.get('time');
  if (!scheduleId || !time) {
    return NextResponse.json({ error: 'Schedule ID and time are required' }, { status: 400 });
  }

  try {
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const scheduleToUpdate = await prisma.schedule.findFirst({
      where: { id: scheduleId, doctorId: doctorProfile.id },
    });

    if (!scheduleToUpdate) {
      return NextResponse.json({ error: 'Schedule not found or you do not have permission to delete it.' }, { status: 404 });
    }

    const timeSlots = (scheduleToUpdate.timeSlots as TimeSlot[]).filter(slot => slot.time !== time);

    if (timeSlots.length === 0) {
      await prisma.schedule.delete({ where: { id: scheduleId } });
    } else {
      await prisma.schedule.update({
        where: { id: scheduleId },
        data: { timeSlots },
      });
    }

    await createAuditLog(session, 'DELETE_SCHEDULE_TIMESLOT', 'Schedule', scheduleId, { time });
    return NextResponse.json({ message: 'Schedule timeslot deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}