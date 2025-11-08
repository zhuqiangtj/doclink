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
// 首先验证预约是否存在，并检查权限
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

// 权限检查：只有相关的医生、病人或管理员可以查看历史记录
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

// 获取历史记录
    const history = await getAppointmentHistory(appointmentId);

// 格式化返回数据，包含预约基本信息
// 若历史记录中缺少已取消条目，但当前状态为已取消，则补齐一条回退记录（用于兼容早期数据）
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