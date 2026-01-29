import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { createAuditLog } from '../../../lib/audit'; // Import from shared utility
import { createAppointmentHistoryInTransaction } from '../../../lib/appointment-history';
import { prisma } from '@/lib/prisma';
import { publishDoctorEvent, publishPatientEvent } from '@/lib/realtime';

// 使用全局 Prisma 单例，避免开发环境热刷新导致连接过多和请求失败

// GET appointments (for doctors or patients)
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    console.error('[API_APPOINTMENTS] Unauthorized attempt to fetch appointments.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const targetPatientId = searchParams.get('patientId');
  const status = searchParams.get('status');
  const page = parseInt(searchParams.get('page') || '0', 10);
  const limit = parseInt(searchParams.get('limit') || '0', 10);

  console.log(`[API_APPOINTMENTS] User ${session.user.username} (${session.user.role}) is fetching appointments. params: patientId=${targetPatientId}, status=${status}, page=${page}, limit=${limit}`);

  try {
    const whereClause: { doctorId?: string; patientId?: string; status?: string; schedule?: { date: string } } = {};

    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { doctorProfile: true } });
      if (!userProfile?.doctorProfile) return NextResponse.json({ error: 'Doctor profile not found' }, { status: 404 });
      whereClause.doctorId = userProfile.doctorProfile.id;
      
      // Allow doctor to filter by specific patient
      if (targetPatientId) {
        whereClause.patientId = targetPatientId;
      }

      // Allow filtering by status
      if (status) {
        whereClause.status = status;
      }

    } else if (session.user.role === 'PATIENT') {
      const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { patientProfile: true } });
      if (!userProfile?.patientProfile) return NextResponse.json({ error: 'Patient profile not found' }, { status: 404 });
      whereClause.patientId = userProfile.patientProfile.id;
    }

    // Prepare query options
    const queryOptions: any = {
      where: whereClause,
      include: {
        patient: { select: { id: true, credibilityScore: true, user: { select: { name: true, phone: true, dateOfBirth: true, gender: true } } } },
        doctor: { include: { user: { select: { name: true } } } },
        room: { select: { id: true, name: true, isPrivate: true } },
        schedule: { select: { date: true } }, // Get date from schedule
        timeSlot: {
          select: {
            startTime: true,
            endTime: true,
            type: true
          }
        },
        history: {
          orderBy: { operatedAt: 'desc' },
          take: 1,
          select: { operatedAt: true, status: true, action: true }
        },
      },
      orderBy: {
        createTime: 'desc',
      },
    };

    // Add pagination if requested
    if (page > 0 && limit > 0) {
      queryOptions.skip = (page - 1) * limit;
      queryOptions.take = limit;
    }

    // Execute queries (parallel if pagination needed to get count)
    let appointments;
    let totalCount = 0;

    if (page > 0 && limit > 0) {
      const [data, count] = await prisma.$transaction([
        prisma.appointment.findMany(queryOptions),
        prisma.appointment.count({ where: whereClause })
      ]);
      appointments = data;
      totalCount = count;
    } else {
      appointments = await prisma.appointment.findMany(queryOptions);
      totalCount = appointments.length;
    }

    // Remap to include date directly for easier frontend consumption
    const formattedAppointments = appointments.map(apt => ({
      ...apt,
      date: apt.schedule.date,
      statusOperatedAt: apt.history && apt.history.length > 0 ? apt.history[0].operatedAt : undefined,
    }));

    // If pagination was used, return object with data and meta
    if (page > 0 && limit > 0) {
      return NextResponse.json({
        data: formattedAppointments,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit)
        }
      });
    }

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

  // 將請求體解析移到 try 外，避免在 catch 中引用未定義變量導致再次拋錯
  const { userId, patientId, doctorId, timeSlotId, roomId } = await request.json();

  try {

    // Authorization check: Patients can only book for themselves. Doctors can book for any patient.
    if (session.user.role === 'PATIENT' && session.user.id !== userId) {
      return NextResponse.json({ error: 'Forbidden: Patients can only book appointments for themselves.' }, { status: 403 });
    }

    if (!userId || !patientId || !doctorId || !timeSlotId || !roomId) {
      return NextResponse.json({ error: 'Missing required appointment data' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
// 验证病人积分，积分小于或等于 0 无法预约
      const patientProfile = await tx.patient.findUnique({ where: { id: patientId } });
      if (!patientProfile) {
        throw new Error('Patient profile not found.');
      }
      if ((patientProfile.credibilityScore ?? 0) <= 0) {
throw new Error('病人积分不足，无法预约');
      }
      // 防重复预约：同一患者在同一时段只能有一条「未取消」的预约记录
      const existingForSlot = await tx.appointment.findFirst({
        where: { patientId, timeSlotId, status: 'PENDING' }
      });
      if (existingForSlot) {
        throw new Error('该病人已在此时段有预约，不能重复预约');
      }
// 获取时间段信息并检查可用性
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

// 仅允许未来时段：检查时段开始时间是否早于当前时间
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

      if (session.user.role === 'PATIENT') {
        if (!timeSlot.schedule?.date) {
          throw new Error('Time slot not found.');
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [y, m, d] = timeSlot.schedule.date.split('-').map(Number);
        const slotDate = new Date(y || 0, (m || 1) - 1, d || 1);
        slotDate.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((slotDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        if (diffDays < 0 || diffDays > 3) {
          throw new Error('病人只能预约未来三天内的时段');
        }
      }

      if (timeSlot.schedule?.date) {
        const dailyLimit = (patientProfile.credibilityScore ?? 0) > 35 ? 2 : 1;
        const existingCountForDay = await tx.appointment.count({
          where: {
            patientId,
            status: 'PENDING',
            schedule: { is: { date: timeSlot.schedule.date } },
          },
        });
        if (existingCountForDay >= dailyLimit) {
          throw new Error(dailyLimit === 1 ? '当日预约已达上限（最多1个）' : '当日预约已达上限（最多2个）');
        }
      }

      if (timeSlot.schedule?.date && timeSlot.startTime) {
        const existingSameDateTime = await tx.appointment.findFirst({
          where: {
            patientId,
            doctorId,
            status: 'PENDING',
            schedule: { is: { date: timeSlot.schedule.date } },
            time: timeSlot.startTime,
            timeSlot: { is: { isActive: true } },
          },
        });
        if (existingSameDateTime) {
          throw new Error('该病人在此时段已有预约');
        }
      }
      const decResult = await tx.timeSlot.updateMany({
        where: { id: timeSlotId, availableBeds: { gt: 0 } },
        data: { availableBeds: { decrement: 1 } }
      });
      if (decResult.count === 0) {
        throw new Error('This time slot is fully booked.');
      }

      const cancelledForSlot = await tx.appointment.findFirst({
        where: { patientId, timeSlotId, status: 'CANCELLED' }
      });

      let newAppointment;
      if (cancelledForSlot) {
        newAppointment = await tx.appointment.update({
          where: { id: cancelledForSlot.id },
          data: {
            status: 'PENDING',
            reason: session.user.role === 'DOCTOR' ? '医生预约' : '病人预约'
          }
        });
        await createAppointmentHistoryInTransaction(tx, {
          appointmentId: newAppointment.id,
          operatorName: session.user.name || session.user.username || 'Unknown',
          operatorId: session.user.id,
          status: 'PENDING',
          reason: session.user.role === 'DOCTOR' ? '医生预约' : '病人预约',
          action: 'REBOOK',
        });
      } else {
        newAppointment = await tx.appointment.create({
          data: {
            userId,
            patientId,
            doctorId,
            scheduleId: timeSlot.scheduleId,
            timeSlotId,
            time: timeSlot.startTime,
            roomId,
            bedId: 0,
            status: 'PENDING',
            reason: session.user.role === 'DOCTOR' ? '医生预约' : '病人预约'
          }
        });
        await createAppointmentHistoryInTransaction(tx, {
          appointmentId: newAppointment.id,
          operatorName: session.user.name || session.user.username || 'Unknown',
          operatorId: session.user.id,
          status: 'PENDING',
          reason: session.user.role === 'DOCTOR' ? '医生预约' : '病人预约',
          action: 'CREATE',
        });
      }

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
    // Publish realtime notifications for doctor and patient channels
    try {
      await Promise.all([
        publishDoctorEvent(doctorId, 'APPOINTMENT_CREATED', {
          appointmentId: result.id,
          timeSlotId,
          actorRole: session.user.role,
        }),
        publishPatientEvent(patientId, 'APPOINTMENT_CREATED', {
          appointmentId: result.id,
          timeSlotId,
          actorRole: session.user.role,
        }),
      ]);
    } catch (e) {
      console.error('[Realtime] APPOINTMENT_CREATED publish failed', e);
    }
    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    // 確保不會因為引用未定義變量而在錯誤處理時再次拋出異常
    const errObj = error as { code?: string };
    // Prisma 唯一約束衝突（並發下的雙擊/重複請求）
    let message = error instanceof Error ? error.message : 'Failed to create appointment';
    if (errObj && typeof errObj.code === 'string' && errObj.code === 'P2002') {
      message = '该病人已在此时段有预约，不能重复预约';
    }

    console.error('Error creating appointment:', {
      error: message,
      original: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      timeSlotId,
      userId,
      patientId,
      doctorId,
      roomId
    });
    
    const status =
      message === '预约的时间段已经过期' ? 400 :
      message === 'Time slot not found.' ? 404 :
      message === 'This time slot is not active.' ? 400 :
      message === 'This time slot is fully booked.' ? 400 :
      message === '病人积分不足，无法预约' ? 400 :
      message === '该病人已在此时段有预约，不能重复预约' ? 400 :
      message === '该病人在此时段已有预约' ? 400 :
      message === 'Patient profile not found.' ? 404 :
      message === '病人只能预约未来三天内的时段' ? 400 :
      message === '当日预约已达上限（最多1个）' ? 400 :
      message === '当日预约已达上限（最多2个）' ? 400 :
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
// 先获取预约信息进行授权检查
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

// 计算取消原因和扣分
    let reason = '';
    let credibilityChange = 0;

    if (session.user.role === 'PATIENT') {
      const appointmentDate = new Date(appointment.schedule.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      appointmentDate.setHours(0, 0, 0, 0);

      if (appointmentDate.getTime() === today.getTime()) {
        reason = '病人当天取消预约';
        credibilityChange = -5;
      } else if (appointmentDate > today) {
        reason = '病人提前取消预约';
        credibilityChange = 0;
      } else {
        return NextResponse.json({ error: 'Forbidden: You cannot cancel an appointment that has already passed' }, { status: 403 });
      }
    } else if (session.user.role === 'DOCTOR') {
reason = '医生取消预约';
      credibilityChange = 0;
    } else {
reason = '管理员取消预约';
      credibilityChange = 0;
    }

    // Execute core data updates within transaction
    await prisma.$transaction(async (tx) => {
// 更新病人信用分数（如果需要）
      if (credibilityChange !== 0 && session.user.role === 'PATIENT') {
        const patientProfile = await tx.patient.findUnique({ where: { userId: session.user.id } });
        if (patientProfile) {
          await tx.patient.update({
            where: { id: patientProfile.id },
            data: { credibilityScore: { increment: credibilityChange } },
          });
        }
      }

// 更新预约状态为已取消
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: 'CANCELLED',
          reason: reason
        }
      });

// 在事务中写入预约历史
      await createAppointmentHistoryInTransaction(tx, {
        appointmentId: updated.id,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: 'CANCELLED',
        reason,
        action: 'CANCEL_APPOINTMENT',
      });

// 更新时段的可用床位数
      if (appointment.timeSlotId) {
        await tx.timeSlot.update({
          where: { id: appointment.timeSlotId },
          data: { availableBeds: { increment: 1 } }
        });
      }

// 创建审计日志
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

// 在事务外创建通知（避免事务超时）
    try {
// 为医生创建通知：仅当病人主动取消时
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

// 如果是医生或管理员取消，为病人创建通知（病人接收对方的操作事件）
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
// 通知创建失败不应该影响主要操作
      console.error('Failed to create notifications:', notificationError);
    }

    // Publish realtime cancellation to doctor and patient channels
    try {
      await Promise.all([
        publishDoctorEvent(appointment.doctorId, 'APPOINTMENT_CANCELLED', {
          appointmentId: appointment.id,
          actorRole: session.user.role,
          reason,
        }),
        publishPatientEvent(appointment.patientId, 'APPOINTMENT_CANCELLED', {
          appointmentId: appointment.id,
          actorRole: session.user.role,
          reason,
        }),
      ]);
    } catch (e) {
      console.error('[Realtime] APPOINTMENT_CANCELLED publish failed', e);
    }
    return NextResponse.json({ message: 'Appointment cancelled successfully' });

  } catch (error) {
    console.error(`Error cancelling appointment ${appointmentId}:`, error);
    const message = error instanceof Error ? error.message : 'Failed to cancel appointment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { appointmentId, newTimeSlotId } = await request.json();
    if (!appointmentId || !newTimeSlotId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (session.user.role !== 'DOCTOR' && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { schedule: true, timeSlot: true }
    });
    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { doctorProfile: true } });
      if (userProfile?.doctorProfile?.id !== appointment.doctorId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const newTimeSlot = await prisma.timeSlot.findUnique({
      where: { id: newTimeSlotId },
      include: { schedule: true }
    });
    if (!newTimeSlot || !newTimeSlot.schedule) {
      return NextResponse.json({ error: 'New time slot not found' }, { status: 404 });
    }
    if (!newTimeSlot.isActive) {
      return NextResponse.json({ error: 'Target time slot is not active' }, { status: 400 });
    }
    const [ny, nm, nd] = newTimeSlot.schedule.date.split('-').map(Number);
    const [nh, nmin] = newTimeSlot.startTime.split(':').map(Number);
    const startDt = new Date(ny, (nm || 1) - 1, nd || 1, nh || 0, nmin || 0, 0, 0);
    if (startDt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Target time slot has expired' }, { status: 400 });
    }
    const scheduleDoctorOk = (await prisma.schedule.findUnique({ where: { id: newTimeSlot.scheduleId } }))?.doctorId === appointment.doctorId;
    if (!scheduleDoctorOk) {
      return NextResponse.json({ error: 'Cannot reschedule to another doctor' }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const dup = await tx.appointment.findFirst({
        where: {
          patientId: appointment.patientId,
          timeSlotId: newTimeSlotId,
          status: { not: 'CANCELLED' },
          id: { not: appointmentId }
        }
      });
      if (dup) {
        throw new Error('该病人在目标时段已有预约');
      }

      const decNew = await tx.timeSlot.updateMany({
        where: { id: newTimeSlotId, availableBeds: { gt: 0 } },
        data: { availableBeds: { decrement: 1 } }
      });
      if (decNew.count === 0) {
        throw new Error('目标时段已满');
      }

      if (appointment.timeSlotId) {
        await tx.timeSlot.update({
          where: { id: appointment.timeSlotId },
          data: { availableBeds: { increment: 1 } }
        });
      }

      const next = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          scheduleId: newTimeSlot.scheduleId,
          timeSlotId: newTimeSlotId,
          time: newTimeSlot.startTime,
          roomId: newTimeSlot.schedule.roomId
        },
        include: {
          schedule: true,
          timeSlot: true,
          room: true
        }
      });

      await createAppointmentHistoryInTransaction(tx, {
        appointmentId,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: next.status,
        reason: '医生改期',
        action: 'RESCHEDULE'
      });

      return next;
    });

    await createAuditLog(session, 'RESCHEDULE_APPOINTMENT', 'Appointment', appointmentId, {
      oldScheduleId: appointment.scheduleId,
      oldTimeSlotId: appointment.timeSlotId,
      newScheduleId: updated.scheduleId,
      newTimeSlotId
    });

    try {
      const actor = await prisma.user.findUnique({ where: { id: session.user.id } });
      if (actor) {
        await prisma.patientNotification.create({
          data: {
            userId: appointment.userId,
            appointmentId: appointment.id,
            doctorName: actor.name,
            message: `您的预约已改期为 ${updated.timeSlot?.startTime || updated.time}`,
            type: 'APPOINTMENT_RESCHEDULED_BY_DOCTOR'
          }
        });
      }
    } catch {}

    try {
      await Promise.all([
        publishDoctorEvent(appointment.doctorId, 'APPOINTMENT_RESCHEDULED', {
          appointmentId,
          oldTimeSlotId: appointment.timeSlotId,
          newTimeSlotId,
          actorRole: session.user.role
        }),
        publishPatientEvent(appointment.patientId, 'APPOINTMENT_RESCHEDULED', {
          appointmentId,
          oldTimeSlotId: appointment.timeSlotId,
          newTimeSlotId,
          actorRole: session.user.role
        })
      ]);
    } catch (e) {
      console.error('[Realtime] APPOINTMENT_RESCHEDULED publish failed', e);
    }

    return NextResponse.json(updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to reschedule appointment';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
