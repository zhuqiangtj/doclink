import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

// GET schedules, optionally filtered by doctorId
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get('doctorId');

  if (!doctorId) {
    return NextResponse.json({ error: 'doctorId is required' }, { status: 400 });
  }

  try {
    const schedules = await prisma.schedule.findMany({
      where: { doctorId },
      include: {
        room: true,
      },
      orderBy: {
        date: 'asc',
      },
    });
    return NextResponse.json(schedules);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}


// POST a new schedule for a doctor
export async function POST(request: Request) {
  try {
    const { doctorId, date, roomId, timeSlots } = await request.json();

    if (!doctorId || !date || !roomId || !timeSlots) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Optional: Add validation to ensure the doctor is assigned to the room
    // Optional: Add validation to prevent creating schedules in the past

    const newSchedule = await prisma.schedule.create({
      data: {
        doctorId,
        date,
        roomId,
        timeSlots, // timeSlots will be a JSON object/array
      },
    });

    return NextResponse.json(newSchedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
