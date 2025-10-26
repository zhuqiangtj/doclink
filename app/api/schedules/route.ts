import { PrismaClient, Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit'; // Import from shared utility

const prisma = new PrismaClient();

// GET schedules for the logged-in doctor
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const userProfile = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { doctorProfile: true },
    });

    if (!userProfile?.doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const schedules = await prisma.schedule.findMany({
      where: { doctorId: userProfile.doctorProfile.id },
      include: {
        room: true, // Include room details in the response
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
    
    const userProfile = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { doctorProfile: true },
    });

    if (userProfile?.doctorProfile?.id !== doctorId) {
      return NextResponse.json({ error: 'Forbidden: You can only create schedules for yourself.' }, { status: 403 });
    }

    const newSchedule = await prisma.schedule.create({
      data: {
        doctorId,
        date,
        roomId,
        timeSlots,
      },
    });

    await createAuditLog(session, 'CREATE_SCHEDULE', 'Schedule', newSchedule.id, { doctorId, date, roomId });
    return NextResponse.json(newSchedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}

// PUT (update) a schedule
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { scheduleId, time, newBedCount, deleteTime } = await request.json();

    if (!scheduleId) {
      return NextResponse.json({ error: 'Schedule ID is required' }, { status: 400 });
    }

    const schedule = await prisma.schedule.findUnique({ where: { id: scheduleId } });
    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    // Authorization: ensure doctor owns the schedule
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (schedule.doctorId !== doctorProfile?.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let timeSlots = schedule.timeSlots as TimeSlot[];

    if (deleteTime && time) {
      timeSlots = timeSlots.filter(slot => slot.time !== time);
    } else if (newBedCount !== undefined && time) {
      const targetSlot = timeSlots.find(slot => slot.time === time);
      if (targetSlot) {
        targetSlot.total = newBedCount;
      }
    }

    const updatedSchedule = await prisma.schedule.update({
      where: { id: scheduleId },
      data: { timeSlots: timeSlots as Prisma.JsonArray },
    });

    await createAuditLog(session, 'UPDATE_SCHEDULE', 'Schedule', scheduleId, { scheduleId, time, newBedCount, deleteTime });
    return NextResponse.json(updatedSchedule);

  } catch (error) {
    console.error('Error updating schedule:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
