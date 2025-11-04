import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '@/lib/audit';
import { DEFAULT_TIME_SLOTS } from '@/scripts/seed-time-slots';

const prisma = new PrismaClient();

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

    // 包含所有仍有活動時段（isActive=true）的日期，即便可用床位為 0（滿額）
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

    // 查找或創建排班
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

    // 創建新的時間段
    // 推斷時段類型（內部字段，API不再要求客戶端提供）
    const inferredType = startTime < '12:00' ? 'MORNING' : 'AFTERNOON';

    const timeSlot = await prisma.timeSlot.create({
      data: {
        scheduleId: schedule.id,
        startTime,
        endTime,
        bedCount: Number(bedCount),
        availableBeds: Number(bedCount),
        type: inferredType,
        isActive: true,
      },
    });

    await createAuditLog(session, 'CREATE_SCHEDULE_TIMESLOT', 'TimeSlot', timeSlot.id, { date, startTime, endTime });
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

    // 驗證時間段是否屬於該醫生
    const timeSlot = await prisma.timeSlot.findFirst({
      where: { 
        id: timeSlotId,
        schedule: { doctorId: doctorProfile.id }
      },
    });

    if (!timeSlot) {
      return NextResponse.json({ error: 'TimeSlot not found or you do not have permission to update it.' }, { status: 404 });
    }

    // 檢查是否有預約，如果有則不能減少床位數
    // 當前 Appointment 模型不包含狀態欄位，統計該時段的所有預約數即可
    const appointmentCount = await prisma.appointment.count({
      where: { 
        timeSlotId: timeSlotId
      }
    });

    const newBedCount = Number(bedCount);
    // 校驗：結束時間必須大於開始時間，床位數必須大於 0
    if (!startTime || !endTime) {
      return NextResponse.json({ error: 'Start and end time are required.' }, { status: 400 });
    }
    if (endTime <= startTime) {
      return NextResponse.json({ error: 'End time must be greater than start time.' }, { status: 400 });
    }
    if (isNaN(newBedCount) || newBedCount <= 0) {
      return NextResponse.json({ error: 'Bed count must be greater than 0.' }, { status: 400 });
    }
    if (appointmentCount > newBedCount) {
      return NextResponse.json({ 
        error: `Cannot reduce bed count to ${newBedCount}. There are ${appointmentCount} confirmed appointments.` 
      }, { status: 400 });
    }

    // 重新推斷類型以滿足資料庫欄位，但不對外暴露或要求
    const inferredType = startTime < '12:00' ? 'MORNING' : 'AFTERNOON';

    const updatedTimeSlot = await prisma.timeSlot.update({
      where: { id: timeSlotId },
      data: { 
        startTime, 
        endTime, 
        bedCount: newBedCount,
        availableBeds: newBedCount - appointmentCount,
        type: inferredType,
        isActive: isActive !== undefined ? isActive : timeSlot.isActive
      },
    });

    await createAuditLog(session, 'UPDATE_SCHEDULE_TIMESLOT', 'TimeSlot', updatedTimeSlot.id, { timeSlotId });
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

    // 驗證時間段是否屬於該醫生
    const timeSlot = await prisma.timeSlot.findFirst({
      where: { 
        id: timeSlotId,
        schedule: { doctorId: doctorProfile.id }
      },
    });

    if (!timeSlot) {
      return NextResponse.json({ error: 'TimeSlot not found or you do not have permission to delete it.' }, { status: 404 });
    }

    // 檢查是否有關聯預約（任意狀態）。目前資料庫未設定對 Appointment 的級聯刪除，
    // 因此只要存在任何關聯預約，就不允許刪除該時段，以避免外鍵約束錯誤。
    const appointmentCount = await prisma.appointment.count({
      where: { timeSlotId: timeSlotId }
    });

    if (appointmentCount > 0) {
      return NextResponse.json({ 
        error: `此時段已有預約記錄（${appointmentCount} 筆），無法刪除。` 
      }, { status: 400 });
    }

    // 刪除時間段
    await prisma.timeSlot.delete({ where: { id: timeSlotId } });

    await createAuditLog(session, 'DELETE_SCHEDULE_TIMESLOT', 'TimeSlot', timeSlotId, { timeSlotId });
    return NextResponse.json({ message: 'TimeSlot deleted successfully' });
  } catch (error) {
    console.error('Error deleting schedule timeslot:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}