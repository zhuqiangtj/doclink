import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'DOCTOR') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: appointmentId } = await params; // Await params for Next.js 15 compatibility

  try {
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findUnique({ 
        where: { id: appointmentId },
        include: { patient: true }
      });
      if (!appointment) throw new Error('預約記錄不存在');

      // 檢查是否為已完成狀態
      if (appointment.status !== 'COMPLETED') {
        throw new Error('只能將已完成的預約標記為爽約');
      }

      // Authorization: Doctor can only mark their own appointments
      const doctorProfile = await tx.doctor.findUnique({ where: { userId: session.user.id } });
      if (appointment.doctorId !== doctorProfile?.id) {
        throw new Error('您只能標記自己的預約為爽約');
      }

      // Update appointment status to NO_SHOW with reason
      const result = await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: 'NO_SHOW',
          reason: '醫生確認爽約'
        },
      });

      // Decrement patient's credibility score by 5
      if (appointment.patient) {
        await tx.patient.update({
          where: { id: appointment.patient.id },
          data: { credibilityScore: { increment: -5 } },
        });
      }

      // 創建通知給病人
      await tx.patientNotification.create({
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
      return result;
    });

    return NextResponse.json({ message: '已成功標記為爽約', appointment: updatedAppointment });

  } catch (error) {
    console.error(`Error marking appointment ${appointmentId} as no-show:`, error);
    const message = error instanceof Error ? error.message : '標記爽約失敗';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
