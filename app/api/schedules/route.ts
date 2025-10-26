import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';

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

    const startDate = new Date(`${month}-01T00:00:00.000Z`);
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
