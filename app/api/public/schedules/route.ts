import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface TimeSlot {
  id: string;
  startTime: string;
  endTime: string;
  bedCount: number;
  availableBeds: number;
  type: 'MORNING' | 'AFTERNOON';
  isActive: boolean;
}

// This is a public endpoint to get available schedules for a specific doctor
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get('doctorId');
  const date = searchParams.get('date'); // New: get date from query

  if (!doctorId) {
    return NextResponse.json({ error: 'A doctorId is required to find schedules.' }, { status: 400 });
  }

  try {
    const whereClause: { doctorId: string; date?: string } = { doctorId: doctorId };
    if (date) {
      whereClause.date = date;
    }

    const schedules = await prisma.schedule.findMany({
      where: whereClause,
      select: {
        id: true,
        date: true,
        room: {
          select: { id: true, name: true }
        },
        timeSlots: {
          where: { isActive: true },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            bedCount: true,
            availableBeds: true,
            type: true,
            isActive: true,
          }
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Filter out time slots that are fully booked
    const availableSchedules = schedules.map(schedule => {
      const availableTimeSlots = schedule.timeSlots.filter(slot => slot.availableBeds > 0);
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
