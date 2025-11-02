import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { createAuditLog } from '../../../../lib/audit';

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
        { error: '缺少預約ID' },
        { status: 400 }
      );
    }

    // 查找預約記錄
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
        { error: '預約記錄不存在' },
        { status: 404 }
      );
    }

    // 檢查預約是否屬於當前醫生
    if (appointment.doctor.user.id !== session.user.id) {
      return NextResponse.json(
        { error: '您只能標記自己的預約為爽約' },
        { status: 403 }
      );
    }

    // 檢查預約狀態是否可以標記為爽約
    if (appointment.status !== 'PENDING' && appointment.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: '只能標記待就診或已完成的預約為爽約' },
        { status: 400 }
      );
    }

    // 檢查預約是否已過期（只對PENDING狀態檢查）
    if (appointment.status === 'PENDING') {
      const now = new Date();
      const chinaTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const appointmentDateTime = new Date(`${appointment.schedule.date}T${appointment.time}`);
      
      if (appointmentDateTime >= chinaTime) {
        return NextResponse.json(
          { error: '只能標記已過期的預約為爽約' },
          { status: 400 }
        );
      }
    }

    // 開始事務處理
    const result = await prisma.$transaction(async (tx) => {
      // 更新預約狀態為爽約
      const updatedAppointment = await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: 'NO_SHOW',
          reason: '醫生確認爽約'
        }
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

      // 記錄審計日誌
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
      message: '已成功標記為爽約',
      appointment: result.appointment,
      patientScore: result.patient.credibilityScore
    });

  } catch (error) {
    console.error('標記爽約錯誤:', error);
    return NextResponse.json(
      { error: '標記爽約時發生錯誤' },
      { status: 500 }
    );
  }
}