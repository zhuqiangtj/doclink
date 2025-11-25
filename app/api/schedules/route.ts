import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit';
import { DEFAULT_TIME_SLOTS } from '@/scripts/seed-time-slots';
import { publishDoctorEvent } from '@/lib/realtime';


interface Appointment {
  id: string;
  patient: { name: string };
  status: string;
  time: string;
}

interface TimeSlot {
  id: string;
  startTime: string;
  endTime: string;
  bedCount: number;
  availableBeds: number;
  type: 'MORNING' | 'AFTERNOON';
  isActive: boolean;
  appointments: Appointment[];
}

// GET dates with available slots for the logged-in doctor
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');

  if (!month || !/\d{4}-\d{2}/.test(month)) {
    return NextResponse.json({ error: 'Month parameter in YYYY-MM format is required.' }, { status: 400 });
  }

  try {
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

    const [year, mon] = month.split('-').map(Number);
    const startDateObj = new Date(year, (mon || 1) - 1, 1);
    const nextMonthObj = new Date(year, (mon || 1), 1);
    const startDate = `${startDateObj.getFullYear()}-${String(startDateObj.getMonth() + 1).padStart(2, '0')}-01`;
    const endDate = `${nextMonthObj.getFullYear()}-${String(nextMonthObj.getMonth() + 1).padStart(2, '0')}-01`;

    const schedules = await prisma.schedule.findMany({
      where: {
        doctorId: doctorProfile.id,
        date: { gte: startDate, lt: endDate },
      },
      include: {
        timeSlots: {
          where: { isActive: true }
        }
      },
    });

// 包含所有仍有活动时段（isActive=true）的日期，即便可用床位为 0（满额）
    const availableDates = schedules
      .filter(s => s.timeSlots && s.timeSlots.length > 0)
      .map(s => s.date);

    const distinctDates = [...new Set(availableDates)];

    return NextResponse.json({ scheduledDates: distinctDates });

  } catch (error) {
    console.error('Error fetching monthly schedule overview:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST a new timeslot to a schedule
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { date, roomId, startTime, endTime, bedCount } = await request.json();
    if (!date || !roomId || !startTime || !endTime || !bedCount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

// 查找或创建排班
    let schedule = await prisma.schedule.findFirst({
      where: { date, doctorId: doctorProfile.id, roomId },
    });

    if (!schedule) {
      schedule = await prisma.schedule.create({
        data: {
          doctorId: doctorProfile.id,
          date,
          roomId,
        },
      });
    }

// 创建新的时段
// 推断时段类型（内部字段，API不再要求客户端提供）
    const inferredType = startTime < '12:00' ? 'MORNING' : 'AFTERNOON';

    // 防重：同一排班下，開始時間或結束時間相同均不可新增
    const sameStart = await prisma.timeSlot.findFirst({
      where: { scheduleId: schedule.id, startTime }
    });
    if (sameStart) {
      return NextResponse.json({ error: '该排班已有相同开始时间的时段' }, { status: 400 });
    }
    const sameEnd = await prisma.timeSlot.findFirst({
      where: { scheduleId: schedule.id, endTime }
    });
    if (sameEnd) {
      return NextResponse.json({ error: '该排班已有相同结束时间的时段' }, { status: 400 });
    }

    // 防重：同一排班相同的開始與結束時間視為同一時段，不允許重複新增
    const existing = await prisma.timeSlot.findFirst({
      where: { scheduleId: schedule.id, startTime, endTime },
    });
    if (existing) {
      return NextResponse.json({ error: '该排班已存在该时间段' }, { status: 400 });
    }

    let timeSlot: TimeSlot | null = null as unknown as TimeSlot;
    try {
      timeSlot = await prisma.timeSlot.create({
        data: {
          scheduleId: schedule.id,
          startTime,
          endTime,
          bedCount: Number(bedCount),
          availableBeds: Number(bedCount),
          type: inferredType,
          isActive: true,
        },
      }) as unknown as TimeSlot;
    } catch (e: any) {
      const code = e?.code || e?.meta?.code;
      if (code === 'P2002') {
        const target = e?.meta?.target as string | undefined;
        if (target?.includes('scheduleId_startTime')) {
          return NextResponse.json({ error: '该排班已有相同开始时间的时段' }, { status: 400 });
        }
        if (target?.includes('scheduleId_endTime')) {
          return NextResponse.json({ error: '该排班已有相同结束时间的时段' }, { status: 400 });
        }
        return NextResponse.json({ error: '该排班已存在该时间段' }, { status: 400 });
      }
      throw e;
    }

    await createAuditLog(session, 'CREATE_SCHEDULE_TIMESLOT', 'TimeSlot', timeSlot.id, { date, startTime, endTime });
    try {
      await publishDoctorEvent(doctorProfile.id, 'TIMESLOT_CREATED', {
        timeSlotId: timeSlot.id,
        date,
        startTime,
        endTime,
        roomId,
      });
    } catch (e) {
      console.error('[Realtime] TIMESLOT_CREATED publish failed', e);
    }
    return NextResponse.json(timeSlot, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT (update) an existing timeslot in a schedule
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const timeSlotId = searchParams.get('timeSlotId');
  if (!timeSlotId) {
    return NextResponse.json({ error: 'TimeSlot ID is required' }, { status: 400 });
  }

  try {
    const { startTime, endTime, bedCount, isActive } = await request.json();
    if (!startTime || !endTime || bedCount === undefined) {
      return NextResponse.json({ error: 'startTime, endTime, and bedCount are required' }, { status: 400 });
    }

    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

// 验证时段是否属于该医生
    const timeSlot = await prisma.timeSlot.findFirst({
      where: { 
        id: timeSlotId,
        schedule: { doctorId: doctorProfile.id }
      },
    });

    if (!timeSlot) {
      return NextResponse.json({ error: 'TimeSlot not found or you do not have permission to update it.' }, { status: 404 });
    }

// 检查是否有预约，若有则禁止任何编辑（包含时间与床位数）。
// 目前“取消预约”在本页面语义为删除记录，因此只要存在任何关联预约记录，就视为有预约。
    const activeAppointmentCount = await prisma.appointment.count({
      where: {
        timeSlotId: timeSlotId,
        status: { not: 'CANCELLED' }
      }
    });

    if (activeAppointmentCount > 0) {
      return NextResponse.json({
        error: `此时段仍有未取消的预约记录（${activeAppointmentCount} 笔），禁止编辑。请先取消所有预约。`
      }, { status: 400 });
    }

    const newBedCount = Number(bedCount);
// 校验：结束时间必须大于开始时间，床位数必须大于 0
    if (!startTime || !endTime) {
      return NextResponse.json({ error: 'Start and end time are required.' }, { status: 400 });
    }
    if (endTime <= startTime) {
      return NextResponse.json({ error: 'End time must be greater than start time.' }, { status: 400 });
    }
    if (isNaN(newBedCount) || newBedCount <= 0) {
      return NextResponse.json({ error: 'Bed count must be greater than 0.' }, { status: 400 });
    }
    // 无预约时，允许编辑；有预约时已在上方直接拦截。

    // 重新推斷類型以滿足資料庫欄位，但不對外暴露或要求
    const inferredType = startTime < '12:00' ? 'MORNING' : 'AFTERNOON';

    // 防重：同一排班下，開始時間或結束時間相同均不可更新為重複值
    const startDup = await prisma.timeSlot.findFirst({
      where: { scheduleId: timeSlot.scheduleId, startTime, id: { not: timeSlotId } }
    });
    if (startDup) {
      return NextResponse.json({ error: '该排班已有相同开始时间的时段' }, { status: 400 });
    }
    const endDup = await prisma.timeSlot.findFirst({
      where: { scheduleId: timeSlot.scheduleId, endTime, id: { not: timeSlotId } }
    });
    if (endDup) {
      return NextResponse.json({ error: '该排班已有相同结束时间的时段' }, { status: 400 });
    }

    const updatedTimeSlot = await prisma.timeSlot.update({
      where: { id: timeSlotId },
      data: { 
        startTime, 
        endTime, 
        bedCount: newBedCount,
        availableBeds: newBedCount - activeAppointmentCount,
        type: inferredType,
        isActive: isActive !== undefined ? isActive : timeSlot.isActive
      },
    });

    await createAuditLog(session, 'UPDATE_SCHEDULE_TIMESLOT', 'TimeSlot', updatedTimeSlot.id, { timeSlotId });
    try {
      await publishDoctorEvent(doctorProfile.id, 'TIMESLOT_UPDATED', {
        timeSlotId,
        startTime,
        endTime,
        bedCount: newBedCount,
        isActive: isActive !== undefined ? isActive : timeSlot.isActive,
      });
    } catch (e) {
      console.error('[Realtime] TIMESLOT_UPDATED publish failed', e);
    }
    return NextResponse.json(updatedTimeSlot);
  } catch (error) {
    console.error('Error updating schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE a timeslot from a schedule
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const timeSlotId = searchParams.get('timeSlotId');
  if (!timeSlotId) {
    return NextResponse.json({ error: 'TimeSlot ID is required' }, { status: 400 });
  }

  try {
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (!doctorProfile) {
      return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
    }

// 验证时段是否属于该医生
    const timeSlot = await prisma.timeSlot.findFirst({
      where: { 
        id: timeSlotId,
        schedule: { doctorId: doctorProfile.id }
      },
      include: { schedule: true }
    });

    if (!timeSlot) {
      return NextResponse.json({ error: 'TimeSlot not found or you do not have permission to delete it.' }, { status: 404 });
    }

// 检查是否有关联预约（任意状态）。目前数据库未设定对 Appointment 的级联删除，
// 因此只要存在任何关联预约，就不允许删除该时段，以避免外键约束错误。
    const activeAppointmentCount = await prisma.appointment.count({
      where: { timeSlotId: timeSlotId, status: { not: 'CANCELLED' } }
    });

    if (activeAppointmentCount > 0) {
      return NextResponse.json({ 
        error: `此时段仍有未取消的预约记录（${activeAppointmentCount} 笔），无法删除。`
      }, { status: 400 });
    }

    // 清理已取消的预约及其历史记录，避免外键约束
    const cancelledAppointments = await prisma.appointment.findMany({
      where: { timeSlotId: timeSlotId, status: 'CANCELLED' },
      select: { id: true }
    });
    const cancelledIds = cancelledAppointments.map(a => a.id);
    if (cancelledIds.length > 0) {
      await prisma.appointmentHistory.deleteMany({ where: { appointmentId: { in: cancelledIds } } });
      await prisma.appointment.deleteMany({ where: { id: { in: cancelledIds } } });
    }

    // 刪除時間段
    await prisma.timeSlot.delete({ where: { id: timeSlotId } });

    await createAuditLog(session, 'DELETE_SCHEDULE_TIMESLOT', 'TimeSlot', timeSlotId, { timeSlotId });
    try {
      await publishDoctorEvent(doctorProfile.id, 'TIMESLOT_DELETED', { timeSlotId });
    } catch (e) {
      console.error('[Realtime] TIMESLOT_DELETED publish failed', e);
    }
    return NextResponse.json({ message: 'TimeSlot deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}