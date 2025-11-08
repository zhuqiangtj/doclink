import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getAppointmentHistory } from '../../../../../lib/appointment-history';
import { prisma } from '../../../../../lib/prisma';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: appointmentId } = await params;

  try {
    // 首先驗證預約是否存在，並檢查權限
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } }
      }
    });

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // 權限檢查：只有相關的醫生、病人或管理員可以查看歷史記錄
    let hasPermission = false;

    if (session.user.role === 'ADMIN') {
      hasPermission = true;
    } else if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ 
        where: { id: session.user.id }, 
        include: { doctorProfile: true } 
      });
      hasPermission = userProfile?.doctorProfile?.id === appointment.doctorId;
    } else if (session.user.role === 'PATIENT') {
      hasPermission = session.user.id === appointment.userId;
    }

    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 獲取歷史記錄
    const history = await getAppointmentHistory(appointmentId);

    // 格式化返回數據，包含預約基本信息
    // 若歷史記錄中缺少已取消條目，但當前狀態為已取消，則補齊一條回退記錄（用於兼容早期數據）
    const hasCancelledHistory = history.some(h => h.status === 'CANCELLED');
    const normalizedHistory = hasCancelledHistory || appointment.status !== 'CANCELLED'
      ? history
      : [
          ...history,
          {
            id: `synthetic-${appointment.id}-cancelled`,
            operatorName: '系統',
            operatedAt: new Date(),
            status: 'CANCELLED',
            reason: appointment.reason || '已取消',
            action: 'UPDATE_STATUS_TO_CANCELLED',
          } as any,
        ];

    const response = {
      appointment: {
        id: appointment.id,
        time: appointment.time,
        status: appointment.status,
        reason: appointment.reason,
        patientName: appointment.patient.user.name,
        doctorName: appointment.doctor.user.name,
        createTime: appointment.createTime
      },
      history: normalizedHistory.map(record => ({
        id: record.id,
        operatorName: record.operatorName,
        operatedAt: record.operatedAt,
        status: record.status,
        reason: record.reason,
        action: record.action
      }))
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching appointment history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch appointment history' }, 
      { status: 500 }
    );
  }
}