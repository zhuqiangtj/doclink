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
  const date = searchParams.get('date');
  const month = searchParams.get('month'); // YYYY-MM
  const aggregate = searchParams.get('aggregate'); // '1' to return month-level detailed schedules

  if (!doctorId) {
    return NextResponse.json({ error: 'A doctorId is required to find schedules.' }, { status: 400 });
  }

  try {
    // Monthly overview or aggregated month details
    if (month && /\d{4}-\d{2}/.test(month)) {
      const [yearStr, monStr] = month.split('-');
      const year = Number(yearStr);
      const mon = Number(monStr);
      const startDateObj = new Date(year, (mon || 1) - 1, 1);
      const nextMonthObj = new Date(year, (mon || 1), 1);
      const startDate = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-01`;
      const endDate = `${nextMonthObj.getFullYear()}-${String(nextMonthObj.getMonth() + 1).padStart(2, '0')}-01`;
      // If aggregate=1, return month-level detailed schedules (single query for the month)
      if (aggregate === '1') {
        const detailedSchedules = await prisma.schedule.findMany({
          where: {
            doctorId,
            date: { gte: startDate, lt: endDate },
          },
          select: {
            id: true,
            date: true,
            room: { select: { id: true, name: true } },
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
                appointments: { select: { id: true } },
              },
              orderBy: { startTime: 'asc' },
            },
          },
          orderBy: { date: 'asc' },
        });

        const datesWithActiveSlots = detailedSchedules
          .filter(s => s.timeSlots && s.timeSlots.length > 0)
          .map(s => s.date);
        const distinctDates = [...new Set(datesWithActiveSlots)];

        // 返回月度所有日期的詳細排班集合（前端可按日期分組），以及有排班的日期集合
        return NextResponse.json({ scheduledDates: distinctDates, schedules: detailedSchedules });
      }

      // Default: monthly overview (distinct dates having active timeslots)
      const schedules = await prisma.schedule.findMany({
        where: {
          doctorId,
          date: { gte: startDate, lt: endDate },
        },
        select: {
          date: true,
          timeSlots: {
            where: { isActive: true },
            select: { id: true },
          },
        },
        orderBy: { date: 'asc' },
      });

      const datesWithActiveSlots = schedules
        .filter(s => s.timeSlots && s.timeSlots.length > 0)
        .map(s => s.date);
      const distinctDates = [...new Set(datesWithActiveSlots)];

      return NextResponse.json({ scheduledDates: distinctDates });
    }

    // Daily details: include minimal appointment info for counts
    const whereClause: { doctorId: string; date?: string } = { doctorId };
    if (date) {
      whereClause.date = date;
    }

    const schedules = await prisma.schedule.findMany({
      where: whereClause,
      select: {
        id: true,
        date: true,
        room: { select: { id: true, name: true } },
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
            appointments: { select: { id: true } },
          },
          orderBy: { startTime: 'asc' },
        },
      },
      orderBy: { date: 'asc' },
    });

    return NextResponse.json(schedules);
  } catch (error) {
    console.error('Error fetching public schedules:', error);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}
