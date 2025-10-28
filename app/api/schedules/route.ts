import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';

const prisma = new PrismaClient();

interface TimeSlot {
  time: string;
  total: number;
  booked: number;
  appointments: unknown[]; // Use unknown instead of any for type safety
}

// GET dates with available slots for the logged-in doctor for a specific month
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
    if (!doctorProfile) return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });

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
        return timeSlots.some(slot => slot.total > slot.booked);
      })
      .map(s => s.date);

    return NextResponse.json({ scheduledDates: [...new Set(availableDates)] });

  } catch (error) {
    console.error('Error fetching monthly schedule:', error);
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
    const { date, roomId, time, total } = await request.json();
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) return NextResponse.json({ error: 'Doctor not found' }, { status: 404 });

    const newTimeSlot: TimeSlot = { time, total: Number(total), booked: 0, appointments: [] };

    const schedule = await prisma.schedule.findFirst({
      where: { doctorId: doctorProfile.id, date, roomId },
    });

    if (schedule) {
      const timeSlots = [...(schedule.timeSlots as TimeSlot[]), newTimeSlot];
      const updatedSchedule = await prisma.schedule.update({
        where: { id: schedule.id },
        data: { timeSlots },
      });
      return NextResponse.json(updatedSchedule, { status: 200 });
    } else {
      const newSchedule = await prisma.schedule.create({
        data: {
          doctorId: doctorProfile.id,
          date,
          roomId,
          timeSlots: [newTimeSlot],
        },
      });
      return NextResponse.json(newSchedule, { status: 201 });
    }
  } catch (error) {
    console.error('Error creating schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) an existing schedule's timeslot
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scheduleId = searchParams.get('scheduleId');
  if (!scheduleId) return NextResponse.json({ error: 'Schedule ID is required' }, { status: 400 });

  try {
    const { time, total, originalTime, roomId } = await request.json();

    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

    const timeSlots = schedule.timeSlots as TimeSlot[];
    const slotIndex = timeSlots.findIndex(slot => slot.time === originalTime);
    if (slotIndex === -1) return NextResponse.json({ error: `Timeslot ${originalTime} not found for update` }, { status: 404 });

    timeSlots[slotIndex] = { ...timeSlots[slotIndex], time, total: Number(total) };

    const updatedSchedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: { timeSlots, roomId },
    });

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
  if (!scheduleId || !time) return NextResponse.json({ error: 'Schedule ID and time are required' }, { status: 400 });

  try {
    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

    const timeSlots = (schedule.timeSlots as TimeSlot[]).filter(slot => slot.time !== time);

    if (timeSlots.length === 0) {
      await prisma.schedule.delete({ where: { id: scheduleId } });
      return NextResponse.json({ message: 'Schedule deleted as it has no more timeslots.' });
    } else {
      const updatedSchedule = await prisma.schedule.update({
        where: { id: scheduleId },
        data: { timeSlots },
      });
      return NextResponse.json(updatedSchedule);
    }
  } catch (error) {
    console.error('Error deleting timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
