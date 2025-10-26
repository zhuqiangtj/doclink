import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import { PrismaClient } from '@prisma/client';
import ScheduleCalendar from './ScheduleCalendar'; // Client Component

const prisma = new PrismaClient();

async function getInitialScheduleData(userId: string) {
  const doctorProfile = await prisma.doctor.findUnique({
    where: { userId },
    include: { Room: true },
  });

  if (!doctorProfile) {
    return { error: 'Doctor profile not found', initialScheduledDates: [], rooms: [] };
  }

  const today = new Date();
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
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
    select: { date: true },
    distinct: ['date'],
  });

  const initialScheduledDates = schedules.map(s => s.date);
  return { initialScheduledDates, rooms: doctorProfile.Room, doctorProfile };
}

export default async function DoctorSchedulePage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    redirect('/auth/signin');
  }

  const { initialScheduledDates, rooms, doctorProfile, error } = await getInitialScheduleData(session.user.id);

  if (error) {
    return <div className="container mx-auto p-8 text-center text-red-500">{error}</div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">排班日历 ({session.user.name})</h1>
      <ScheduleCalendar 
        initialScheduledDates={initialScheduledDates}
        rooms={rooms}
        doctorProfile={doctorProfile}
      />
    </div>
  );
}
