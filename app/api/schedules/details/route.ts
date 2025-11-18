import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';


// GET detailed schedule for a specific date
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const timeSlotId = searchParams.get('timeSlotId');
  const scheduleId = searchParams.get('scheduleId');

  if (!date && !timeSlotId && !scheduleId) {
    return NextResponse.json({ error: 'Date or timeSlotId or scheduleId is required.' }, { status: 400 });
  }

  try {
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    // Fine-grained: fetch by specific timeSlotId or scheduleId if provided
    if (timeSlotId) {
      const schedule = await prisma.schedule.findFirst({
        where: { doctorId: doctorProfile.id, timeSlots: { some: { id: timeSlotId } } },
        include: {
          room: true,
          doctor: {
            include: {
              user: { select: { name: true, role: true } }
            }
          },
          timeSlots: {
            where: { id: timeSlotId },
            include: {
              appointments: {
                where: { status: { not: 'CANCELLED' } },
                include: {
                  patient: { select: { credibilityScore: true, user: { select: { name: true, gender: true, dateOfBirth: true, phone: true } } } },
                  user: { select: { name: true, role: true } },
                  history: {
                    select: { operatedAt: true, operatorName: true, action: true },
                    orderBy: { operatedAt: 'desc' },
                    take: 1
                  }
                }
              }
            },
            orderBy: { startTime: 'asc' }
          }
        }
      });
      return NextResponse.json(schedule ? [schedule] : []);
    }

    if (scheduleId) {
      const schedule = await prisma.schedule.findFirst({
        where: { id: scheduleId, doctorId: doctorProfile.id },
        include: {
          room: true,
          doctor: {
            include: {
              user: { select: { name: true, role: true } }
            }
          },
          timeSlots: {
            where: { isActive: true },
            include: {
              appointments: {
                where: { status: { not: 'CANCELLED' } },
                include: {
                  patient: { select: { credibilityScore: true, user: { select: { name: true, gender: true, dateOfBirth: true, phone: true } } } },
                  user: { select: { name: true, role: true } },
                  history: {
                    select: { operatedAt: true, operatorName: true, action: true },
                    orderBy: { operatedAt: 'desc' },
                    take: 1
                  }
                }
              }
            },
            orderBy: { startTime: 'asc' }
          }
        }
      });
      return NextResponse.json(schedule ? [schedule] : []);
    }

    // Default: fetch by date (existing behavior)
    const schedules = await prisma.schedule.findMany({
      where: { doctorId: doctorProfile.id, date: date as string },
      include: {
        room: true,
        doctor: {
          include: {
            user: { select: { name: true, role: true } }
          }
        },
        timeSlots: {
          where: { isActive: true },
          include: {
            appointments: {
              where: { status: { not: 'CANCELLED' } },
              include: {
                patient: { select: { credibilityScore: true, user: { select: { name: true, gender: true, dateOfBirth: true, phone: true } } } },
                user: { select: { name: true, role: true } },
                history: {
                  select: { operatedAt: true, operatorName: true, action: true },
                  orderBy: { operatedAt: 'desc' },
                  take: 1
                }
              }
            }
          },
          orderBy: { startTime: 'asc' }
        }
      }
    });
    return NextResponse.json(schedules);

  } catch (error) {
    console.error('Error fetching schedule details:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
