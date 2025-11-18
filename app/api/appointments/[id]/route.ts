import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { createAppointmentHistoryInTransaction } from '@/lib/appointment-history';

export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const appointmentId = context.params?.id;
  if (!appointmentId) {
    return NextResponse.json({ error: 'Appointment ID is required' }, { status: 400 });
  }

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { credibilityScore: true, user: { select: { name: true, phone: true, dateOfBirth: true } } } },
        doctor: { include: { user: { select: { name: true } } } },
        room: { select: { name: true } },
        schedule: { select: { date: true } },
        timeSlot: { select: { startTime: true, endTime: true, type: true } },
      },
    });
    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { doctorProfile: true } });
      if (!userProfile?.doctorProfile || appointment.doctorId !== userProfile.doctorProfile.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (session.user.role === 'PATIENT') {
      const userProfile = await prisma.user.findUnique({ where: { id: session.user.id }, include: { patientProfile: true } });
      if (!userProfile?.patientProfile || appointment.patientId !== userProfile.patientProfile.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const formatted = { ...appointment, date: appointment.schedule?.date };
    return NextResponse.json(formatted);
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/appointments/[id] — 取消预约（RESTful 动态路由）
export async function DELETE(
  request: Request,
  context: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const appointmentId = context.params?.id;
  if (!appointmentId) {
    return NextResponse.json({ error: 'Appointment ID is required' }, { status: 400 });
  }

  try {
    // 获取预约信息并进行授权检查
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        schedule: true,
        timeSlot: true,
      },
    });
    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // 授权规则：医生只能取消自己的预约；患者只能取消自己的预约；管理员可取消任意预约
    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { doctorProfile: true },
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

    // 计算取消原因与积分变化
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

    // 事务：更新预约状态、历史、时段可用床位、审计日志；患者扣分（仅患者取消且需要扣分）
    await prisma.$transaction(async (tx) => {
      if (credibilityChange !== 0 && session.user.role === 'PATIENT') {
        const patientProfile = await tx.patient.findUnique({ where: { userId: session.user.id } });
        if (patientProfile) {
          await tx.patient.update({
            where: { id: patientProfile.id },
            data: { credibilityScore: { increment: credibilityChange } },
          });
        }
      }

      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: 'CANCELLED',
          reason,
        },
      });

      await createAppointmentHistoryInTransaction(tx, {
        appointmentId: updated.id,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: 'CANCELLED',
        reason,
        action: 'CANCEL_APPOINTMENT',
      });

      if (appointment.timeSlotId) {
        await tx.timeSlot.update({
          where: { id: appointment.timeSlotId },
          data: { availableBeds: { increment: 1 } },
        });
      }

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
            reason,
            credibilityChange,
          }),
        },
      });
    });

    // 在事务外创建通知
    try {
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
      console.error('Failed to create notifications:', notificationError);
    }

    return NextResponse.json({ message: 'Appointment cancelled successfully' });
  } catch (error) {
    console.error(`Error cancelling appointment ${appointmentId}:`, error);
    const message = error instanceof Error ? error.message : 'Failed to cancel appointment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}