import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient();

interface TimeSlot { 
  time: string; 
  total: number; 
  booked: number; 
}

// GET detailed schedule for a specific date
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date'); // e.g., "2025-11-25"

  if (!date) {
    return NextResponse.json({ error: 'Date parameter is required.' }, { status: 400 });
  }

  try {
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const schedules = await prisma.schedule.findMany({
      where: {
        doctorId: doctorProfile.id,
        date: date,
      },
      include: {
        room: true,
      },
    });

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId: doctorProfile.id,
        date: date,
      },
      select: {
        id: true,
        time: true,
        status: true,
        patient: { select: { user: { select: { name: true } } } },
        scheduleId: true,
      },
    });

    // Manually merge appointments into their respective time slots
    const schedulesWithAppointments = schedules.map(schedule => {
      const timeSlotsWithAppointments = (schedule.timeSlots as TimeSlot[]).map(slot => {
        return {
          ...slot,
          appointments: appointments.filter(apt => apt.scheduleId === schedule.id && apt.time === slot.time),
        };
      });
      return { ...schedule, timeSlots: timeSlotsWithAppointments };
    });

    return NextResponse.json(schedulesWithAppointments);

  } catch (error) {
    console.error('Error fetching schedule details:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
