import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { createAuditLog } from '../../../../../lib/audit';
import { prisma } from '../../../../../lib/prisma';
import { createAppointmentHistoryInTransaction } from '../../../../../lib/appointment-history';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: appointmentId } = await params; // Await params for Next.js 15 compatibility

  try {
    // 先在事務外輕量校驗，縮短事務時間
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        doctorId: true,
        userId: true,
        patientId: true,
        time: true,
        schedule: { select: { date: true } }
      }
    });
if (!appointment) throw new Error('预约记录不存在');

// 不允许对已取消或已爽约的预约重复标记
    if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') {
throw new Error('无法标记已取消或已爽约的预约');
    }

// 检查时间段是否已过期（以开始时间为准，允许等于当前时间）
    if (!appointment.schedule?.date || !appointment.time) {
throw new Error('预约记录缺少日期或时间信息');
    }
    const now = new Date();
    const appointmentDateTime = new Date(`${appointment.schedule.date}T${appointment.time}`);
    if (appointmentDateTime > now) {
throw new Error('只能标记已过期的预约为爽约');
    }

    // Authorization: Doctor can only mark their own appointments
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (appointment.doctorId !== doctorProfile?.id) {
throw new Error('您只能标记自己的预约为爽约');
    }

    // 事務內僅保留必要的寫操作，並提升超時上限
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const result = await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: 'NO_SHOW',
reason: '医生确认爽约'
        },
      });

      await createAppointmentHistoryInTransaction(tx, {
        appointmentId: appointmentId,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: 'NO_SHOW',
reason: '医生确认爽约',
        action: 'MARK_NO_SHOW',
      });

      if (appointment.patientId) {
        await tx.patient.update({
          where: { id: appointment.patientId },
          data: { credibilityScore: { increment: -5 } },
        });
      }

      return result;
    }, { timeout: 15000 });

// 事务外执行通知与审计，避免延长锁持有时间
    await prisma.patientNotification.create({
      data: {
        userId: appointment.userId,
        appointmentId: appointment.id,
doctorName: session.user.name || '医生',
message: `您的预约 (预约时间: ${appointment.time}) 已被医生标记为爽约，扣除5分信用分数。`,
        type: 'APPOINTMENT_NO_SHOW',
      },
    });

    await createAuditLog(session, 'DOCTOR_MARK_NO_SHOW', 'Appointment', appointmentId, { 
        patientId: appointment.patientId, 
        oldStatus: appointment.status,
        newStatus: 'NO_SHOW',
reason: '医生确认爽约',
        credibilityChange: -5
    });

return NextResponse.json({ message: '已成功标记为爽约', appointment: updatedAppointment });

  } catch (error) {
    console.error(`Error marking appointment ${appointmentId} as no-show:`, error);
const message = error instanceof Error ? error.message : '标记爽约失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
