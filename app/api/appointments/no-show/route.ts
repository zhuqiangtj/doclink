import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { createAuditLog } from '../../../../lib/audit';
import { createAppointmentHistoryInTransaction } from '../../../../lib/appointment-history';

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session || session.user.role !== 'DOCTOR') {
      return NextResponse.json(
        { error: '未授權訪問' },
        { status: 401 }
      );
    }

    const { appointmentId } = await request.json();

    if (!appointmentId) {
      return NextResponse.json(
  { error: '缺少预约ID' },
        { status: 400 }
      );
    }

// 查找预约记录
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: {
          include: {
            user: true
          }
        },
        doctor: {
          include: {
            user: true
          }
        },
        room: true,
        schedule: true
      }
    });

    if (!appointment) {
      return NextResponse.json(
  { error: '预约记录不存在' },
        { status: 404 }
      );
    }

// 检查预约是否属于当前医生
    if (appointment.doctor.user.id !== session.user.id) {
      return NextResponse.json(
  { error: '您只能标记自己的预约为爽约' },
        { status: 403 }
      );
    }

// 检查预约状态是否可以标记为爽约
    if (appointment.status !== 'PENDING' && appointment.status !== 'COMPLETED') {
      return NextResponse.json(
  { error: '只能标记待就诊或已完成的预约为爽约' },
        { status: 400 }
      );
    }

// 检查预约是否已过期（只对 PENDING 状态检查）
    if (appointment.status === 'PENDING') {
      const now = new Date();
      const chinaTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const appointmentDateTime = new Date(`${appointment.schedule.date}T${appointment.time}`);
      
      if (appointmentDateTime >= chinaTime) {
        return NextResponse.json(
  { error: '只能标记已过期的预约为爽约' },
          { status: 400 }
        );
      }
    }

    // 開始事務處理
    const result = await prisma.$transaction(async (tx) => {
// 更新预约状态为爽约
      const updatedAppointment = await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: 'NO_SHOW',
  reason: '医生确认爽约'
        }
      });

// 写入预约历史记录
      await createAppointmentHistoryInTransaction(tx, {
        appointmentId,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: 'NO_SHOW',
  reason: '医生确认爽约',
        action: 'MARK_NO_SHOW',
      });

// 扣除病人5分
      const updatedPatient = await tx.patient.update({
        where: { id: appointment.patient.id },
        data: {
          credibilityScore: {
            decrement: 5
          }
        }
      });

// 记录审计日志
      await createAuditLog(
        session,
        'MARK_NO_SHOW',
        'Appointment',
        appointmentId,
        {
          patientName: appointment.patient.user.name,
          appointmentDate: appointment.schedule.date,
          appointmentTime: appointment.time,
          roomName: appointment.room.name,
          scoreDeducted: 5,
          newPatientScore: updatedPatient.credibilityScore
        }
      );

      return {
        appointment: updatedAppointment,
        patient: updatedPatient
      };
    });

    return NextResponse.json({
  message: '已成功标记为爽约',
      appointment: result.appointment,
      patientScore: result.patient.credibilityScore
    });

  } catch (error) {
  console.error('标记爽约错误:', error);
    return NextResponse.json(
  { error: '标记爽约时发生错误' },
      { status: 500 }
    );
  }
}