import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

interface DTimeSlot {
  id: string;
  startTime: string;
  endTime: string;
  bedCount: number;
  availableBeds: number;
  type: string;
  isActive: boolean;
  appointments: unknown[];
}

interface DSchedule {
  id: string;
  date: string;
  room: { id: string; name: string };
  timeSlots: DTimeSlot[];
  doctor: unknown;
}

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
    const byRoom = new Map<string, DSchedule>();
    for (const s of schedules) {
      const key = s?.room?.id || s.id;
      const existing = byRoom.get(key);
      if (!existing) {
        const sortedSlots = [...(s.timeSlots || [])].sort((a, b) => a.startTime.localeCompare(b.startTime));
        byRoom.set(key, { ...s, timeSlots: sortedSlots });
      } else {
        const slotsMap = new Map<string, DTimeSlot>();
        for (const t of existing.timeSlots || []) slotsMap.set(t.id, t);
        for (const t of s.timeSlots || []) slotsMap.set(t.id, t);
        const mergedSlots = Array.from(slotsMap.values()).sort((a, b) => a.startTime.localeCompare(b.startTime));
        byRoom.set(key, { ...existing, timeSlots: mergedSlots });
      }
    }
    const merged = Array.from(byRoom.values());
    return NextResponse.json(merged);

  } catch (error) {
    console.error('Error fetching schedule details:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
