import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '../../../lib/audit'; // Import from shared utility
import { createAppointmentHistoryInTransaction } from '../../../lib/appointment-history';

const prisma = new PrismaClient();

// GET appointments (for doctors or patients)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    console.error('[API_APPOINTMENTS] Unauthorized attempt to fetch appointments.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  console.log(`[API_APPOINTMENTS] User ${session.user.username} (${session.user.role}) is fetching appointments.`);

  try {
    const whereClause: { doctorId?: string; patientId?: string; status?: string; schedule?: { date: string } } = {};

    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { doctorProfile: true } });
      if (!userProfile?.doctorProfile) return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
      whereClause.doctorId = userProfile.doctorProfile.id;

    } else if (session.user.role === 'PATIENT') {
       const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { patientProfile: true } });
       if (!userProfile?.patientProfile) return NextResponse.json({ error: 'Patient profile not found' }, { status: 404 });
      whereClause.patientId = userProfile.patientProfile.id;
    }

    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      include: {
        patient: { include: { user: { select: { name: true } } } },
        doctor: { include: { user: { select: { name: true } } } },
        room: { select: { name: true } },
        schedule: { select: { date: true } }, // Get date from schedule
        timeSlot: { 
          select: { 
            startTime: true, 
            endTime: true, 
            type: true 
          } 
        },
      },
      orderBy: {
        createTime: 'desc',
      },
    });

    // Remap to include date directly for easier frontend consumption
    const formattedAppointments = appointments.map(apt => ({
      ...apt,
      date: apt.schedule.date,
    }));

    return NextResponse.json(formattedAppointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}


// POST a new appointment (book a slot)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { userId, patientId, doctorId, timeSlotId, roomId } = await request.json();

    // Authorization check: Patients can only book for themselves. Doctors can book for any patient.
    if (session.user.role === 'PATIENT' && session.user.id !== userId) {
      return NextResponse.json({ error: 'Forbidden: Patients can only book appointments for themselves.' }, { status: 403 });
    }

    if (!userId || !patientId || !doctorId || !timeSlotId || !roomId) {
      return NextResponse.json({ error: 'Missing required appointment data' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 獲取時間段信息並檢查可用性
      const timeSlot = await tx.timeSlot.findUnique({
        where: { id: timeSlotId },
        include: { schedule: true }
      });
      
      if (!timeSlot) {
        throw new Error('Time slot not found.');
      }

      if (!timeSlot.isActive) {
        throw new Error('This time slot is not active.');
      }

      // 僅允許未來時間段：檢查時間段開始時間是否早於當前時間
      if (timeSlot.schedule && timeSlot.schedule.date && timeSlot.startTime) {
        const [year, month, day] = timeSlot.schedule.date.split('-').map(Number);
        const [hour, minute] = timeSlot.startTime.split(':').map(Number);
        // 使用本地時間構造，避免時區解析差異
        const slotStartDateTime = new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0);
        const now = new Date();
        if (slotStartDateTime.getTime() <= now.getTime()) {
          throw new Error('预约的时间段已经过期');
        }
      }

      // 原子性防超訂：僅在 availableBeds > 0 時遞減，否則報錯
      const decResult = await tx.timeSlot.updateMany({
        where: { id: timeSlotId, availableBeds: { gt: 0 } },
        data: { availableBeds: { decrement: 1 } }
      });
      if (decResult.count === 0) {
        throw new Error('This time slot is fully booked.');
      }

      // 創建預約，使用時間段的開始時間作為time字段（向後兼容）
      const newAppointment = await tx.appointment.create({
        data: { 
          userId, 
          patientId, 
          doctorId, 
          scheduleId: timeSlot.scheduleId,
          timeSlotId,
          time: timeSlot.startTime, // 向後兼容
          roomId, 
          bedId: 0, 
          status: 'PENDING', 
          reason: session.user.role === 'DOCTOR' ? '醫生預約' : '病人預約'
        },
      });

      // 創建預約歷史記錄
      await createAppointmentHistoryInTransaction(tx, {
        appointmentId: newAppointment.id,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: 'PENDING',
        reason: session.user.role === 'DOCTOR' ? '醫生預約' : '病人預約',
        action: 'CREATE',
      });

      // Create a notification for the doctor ONLY when the actor is PATIENT
      if (session.user.role === 'PATIENT') {
        const patientUser = await tx.user.findUnique({ where: { id: userId } });
        if (patientUser) {
          await tx.notification.create({
            data: {
              doctorId: doctorId,
              appointmentId: newAppointment.id,
              patientName: patientUser.name,
              message: `${patientUser.name} 预约了您在 ${timeSlot.startTime}-${timeSlot.endTime} 的号。`,
              type: 'APPOINTMENT_CREATED',
            },
          });
        }
      }

      // Create a notification for the patient if the doctor is booking
      if (session.user.role === 'DOCTOR') {
        const doctorUser = await tx.user.findUnique({ where: { id: session.user.id } });
        if (doctorUser) {
          await tx.patientNotification.create({
            data: {
              userId: userId,
              appointmentId: newAppointment.id,
              doctorName: doctorUser.name,
              message: `医生 ${doctorUser.name} 为您安排了在 ${timeSlot.startTime}-${timeSlot.endTime} 的预约。`,
              type: 'APPOINTMENT_CREATED_BY_DOCTOR',
            },
          });
        }
      }

      return newAppointment;
    });

    await createAuditLog(session, 'CREATE_APPOINTMENT', 'Appointment', result.id, { userId, patientId, doctorId, timeSlotId, roomId });
    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    console.error('Error creating appointment:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      timeSlotId,
      userId,
      patientId,
      doctorId,
      roomId
    });
    
    const message = error instanceof Error ? error.message : 'Failed to create appointment';
    const status =
      message === '预约的时间段已经过期' ? 400 :
      message === 'Time slot not found.' ? 404 :
      message === 'This time slot is not active.' ? 400 :
      message === 'This time slot is fully booked.' ? 400 :
      500;
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE an appointment (cancel)
export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const appointmentId = searchParams.get('appointmentId');

  if (!appointmentId) {
    return NextResponse.json({ error: 'Appointment ID is required' }, { status: 400 });
  }

  try {
    // 先獲取預約信息進行授權檢查
    const appointment = await prisma.appointment.findUnique({ 
      where: { id: appointmentId },
      include: { 
        schedule: true,
        timeSlot: true
      }
    });
    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // Authorization check
    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ 
        where: { id: session.user.id }, 
        include: { doctorProfile: true } 
      });
      if (userProfile?.doctorProfile?.id !== appointment.doctorId) {
        return NextResponse.json({ error: 'Forbidden: You can only cancel your own appointments' }, { status: 403 });
      }
    } else if (session.user.role === 'PATIENT') {
      if (session.user.id !== appointment.userId) {
        return NextResponse.json({ error: 'Forbidden: You can only cancel your own appointments' }, { status: 403 });
      }
    } else if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden: You do not have permission to cancel this appointment' }, { status: 403 });
    }

    // 計算取消原因和扣分
    let reason = '';
    let credibilityChange = 0;

    if (session.user.role === 'PATIENT') {
      const appointmentDate = new Date(appointment.schedule.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      appointmentDate.setHours(0, 0, 0, 0);

      if (appointmentDate.getTime() === today.getTime()) {
        reason = '病人當天取消預約';
        credibilityChange = -5;
      } else if (appointmentDate > today) {
        reason = '病人提前取消預約';
        credibilityChange = -2;
      } else {
        return NextResponse.json({ error: 'Forbidden: You cannot cancel an appointment that has already passed' }, { status: 403 });
      }
    } else if (session.user.role === 'DOCTOR') {
      reason = '醫生取消預約';
      credibilityChange = 0;
    } else {
      reason = '管理員取消預約';
      credibilityChange = 0;
    }

    // Execute core data updates within transaction
    await prisma.$transaction(async (tx) => {
      // 更新病人信用分數（如果需要）
      if (credibilityChange !== 0 && session.user.role === 'PATIENT') {
        const patientProfile = await tx.patient.findUnique({ where: { userId: session.user.id } });
        if (patientProfile) {
          await tx.patient.update({
            where: { id: patientProfile.id },
            data: { credibilityScore: { increment: credibilityChange } },
          });
        }
      }

      // 更新預約狀態為已取消
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: 'CANCELLED',
          reason: reason
        }
      });

      // 更新時間段的可用床位數
      if (appointment.timeSlotId) {
        await tx.timeSlot.update({
          where: { id: appointment.timeSlotId },
          data: { availableBeds: { increment: 1 } }
        });
      }

      // 創建審計日誌
      await tx.auditLog.create({
        data: {
          userId: session?.user?.id,
          userName: session?.user?.name,
          userUsername: session?.user?.username,
          userRole: session?.user?.role,
          action: 'CANCEL_APPOINTMENT',
          entityType: 'Appointment',
          entityId: appointmentId,
          details: JSON.stringify({ 
            doctorId: appointment.doctorId, 
            patientId: appointment.patientId, 
            status: appointment.status,
            reason: reason,
            credibilityChange
          }),
        },
      });
    });

    // 在事務外創建通知（避免事務超時）
    try {
      // 為醫生創建通知：僅當病人主動取消時
      if (session.user.role === 'PATIENT') {
        const patientUser = await prisma.user.findUnique({ where: { id: appointment.userId } });
        if (patientUser) {
          await prisma.notification.create({
            data: {
              doctorId: appointment.doctorId,
              appointmentId: appointment.id,
              patientName: patientUser.name,
              message: `${patientUser.name} 取消了 ${appointment.timeSlot?.startTime || appointment.time} 的预约。`,
              type: 'APPOINTMENT_CANCELLED',
            },
          });
        }
      }

      // 如果是醫生或管理員取消，為病人創建通知（病人接收對方的操作事件）
      if (session.user.role === 'DOCTOR' || session.user.role === 'ADMIN') {
        const actor = await prisma.user.findUnique({ where: { id: session.user.id } });
        if (actor) {
          await prisma.patientNotification.create({
            data: {
              userId: appointment.userId,
              appointmentId: appointment.id,
              doctorName: actor.name,
              message: `您的预约 (预约时间: ${appointment.timeSlot?.startTime || appointment.time}) 已被 ${actor.name} 取消。`,
              type: 'APPOINTMENT_CANCELLED_BY_DOCTOR',
            },
          });
        }
      }
    } catch (notificationError) {
      // 通知創建失敗不應該影響主要操作
      console.error('Failed to create notifications:', notificationError);
    }

    return NextResponse.json({ message: 'Appointment cancelled successfully' });

  } catch (error) {
    console.error(`Error cancelling appointment ${appointmentId}:`, error);
    const message = error instanceof Error ? error.message : 'Failed to cancel appointment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
