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
    if (!appointment) throw new Error('預約記錄不存在');

    // 不允許對已取消或已爽約的預約重複標記
    if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') {
      throw new Error('無法標記已取消或已爽約的預約');
    }

    // 檢查時間段是否已過期（以開始時間為準，允許等於當前時間）
    if (!appointment.schedule?.date || !appointment.time) {
      throw new Error('預約記錄缺少日期或時間信息');
    }
    const now = new Date();
    const appointmentDateTime = new Date(`${appointment.schedule.date}T${appointment.time}`);
    if (appointmentDateTime > now) {
      throw new Error('只能標記已過期的預約為爽約');
    }

    // Authorization: Doctor can only mark their own appointments
    const doctorProfile = await prisma.doctor.findUnique({ where: { userId: session.user.id } });
    if (appointment.doctorId !== doctorProfile?.id) {
      throw new Error('您只能標記自己的預約為爽約');
    }

    // 事務內僅保留必要的寫操作，並提升超時上限
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const result = await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: 'NO_SHOW',
          reason: '醫生確認爽約'
        },
      });

      await createAppointmentHistoryInTransaction(tx, {
        appointmentId: appointmentId,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: 'NO_SHOW',
        reason: '醫生確認爽約',
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

    // 事務外執行通知與審計，避免延長鎖持有時間
    await prisma.patientNotification.create({
      data: {
        userId: appointment.userId,
        appointmentId: appointment.id,
        doctorName: session.user.name || '醫生',
        message: `您的預約 (預約時間: ${appointment.time}) 已被醫生標記為爽約，扣除5分信用分數。`,
        type: 'APPOINTMENT_NO_SHOW',
      },
    });

    await createAuditLog(session, 'DOCTOR_MARK_NO_SHOW', 'Appointment', appointmentId, { 
        patientId: appointment.patientId, 
        oldStatus: appointment.status,
        newStatus: 'NO_SHOW',
        reason: '醫生確認爽約',
        credibilityChange: -5
    });

    return NextResponse.json({ message: '已成功標記為爽約', appointment: updatedAppointment });

  } catch (error) {
    console.error(`Error marking appointment ${appointmentId} as no-show:`, error);
    const message = error instanceof Error ? error.message : '標記爽約失敗';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
