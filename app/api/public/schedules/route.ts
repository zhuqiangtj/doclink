import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

interface TimeSlot {
  time: string;
  total: number;
  booked: number;
}

// This is a public endpoint to get available schedules for a specific doctor
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get('doctorId');

  if (!doctorId) {
    return NextResponse.json({ error: 'A doctorId is required to find schedules.' }, { status: 400 });
  }

  try {
    const schedules = await prisma.schedule.findMany({
      where: {
        doctorId: doctorId,
        // Optional: Add a date filter to only show future schedules
        // date: { gte: new Date().toISOString().split('T')[0] }
      },
      select: {
        id: true,
        date: true,
        room: {
          select: { id: true, name: true }
        },
        timeSlots: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Filter out time slots that are fully booked
    const availableSchedules = schedules.map(schedule => {
      const availableTimeSlots = (schedule.timeSlots as unknown as TimeSlot[]).filter(slot => slot.booked < slot.total);
      return {
        ...schedule,
        timeSlots: availableTimeSlots,
      };
    }).filter(schedule => schedule.timeSlots.length > 0); // Only return schedules with at least one available slot

    return NextResponse.json(availableSchedules);
  } catch (error) {
    console.error('Error fetching public schedules:', error);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}
