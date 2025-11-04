import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { createAuditLog } from '../../../../lib/audit';
import { createAppointmentHistoryInTransaction } from '../../../../lib/appointment-history';

// PUT - 更新預約狀態
export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { appointmentId, status, reason } = await request.json();

    if (!appointmentId || !status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 驗證狀態值
    const validStatuses = ['PENDING', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // 獲取預約信息
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        schedule: true,
        patient: { include: { user: true } },
        doctor: { include: { user: true } }
      }
    });

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // 權限檢查
    if (session.user.role === 'DOCTOR') {
      const userProfile = await prisma.user.findUnique({ 
        where: { id: session.user.id }, 
        include: { doctorProfile: true } 
      });
      if (userProfile?.doctorProfile?.id !== appointment.doctorId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (session.user.role === 'PATIENT') {
      if (session.user.id !== appointment.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let finalReason = reason;
    let credibilityChange = 0;

    // 處理不同的狀態變更邏輯
    if (status === 'CANCELLED') {
      const appointmentDate = new Date(appointment.schedule.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      appointmentDate.setHours(0, 0, 0, 0);

      if (appointmentDate.getTime() === today.getTime()) {
        // 當日取消，視為爽約
        finalReason = '當日病人當天取消預約';
        credibilityChange = -5;
      } else if (appointmentDate > today) {
        // 提前取消
        finalReason = '病人預約日之前提前取消';
      } else {
        return NextResponse.json({ error: '無法取消已過期的預約' }, { status: 400 });
      }
    } else if (status === 'NO_SHOW' && appointment.status === 'COMPLETED') {
      // 醫生標記爽約
      finalReason = '醫生確認爽約';
      credibilityChange = -5;
    } else if (status === 'COMPLETED' && appointment.status === 'PENDING') {
      // 自動完成
      finalReason = finalReason || '自動到期完成就診';
    }

    // 更新預約狀態
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: status as any,
          reason: finalReason 
        }
      });

      // 創建預約歷史記錄
      await createAppointmentHistoryInTransaction(tx, {
        appointmentId: appointmentId,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: status as any,
        reason: finalReason,
        action: `UPDATE_STATUS_TO_${status}`,
      });

      // 如果需要扣分，更新病人信用分數
      if (credibilityChange !== 0) {
        await tx.patient.update({
          where: { id: appointment.patientId },
          data: { 
            credibilityScore: { 
              increment: credibilityChange 
            } 
          }
        });
      }

      return updated;
    });

    // 記錄審計日誌
    await createAuditLog(
      session, 
      'UPDATE_APPOINTMENT_STATUS', 
      'Appointment', 
      appointmentId, 
      { 
        oldStatus: appointment.status, 
        newStatus: status, 
        reason: finalReason,
        credibilityChange 
      }
    );

    return NextResponse.json(updatedAppointment);

  } catch (error) {
    console.error('Error updating appointment status:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST - 自動更新過期預約狀態
export async function POST() {
  try {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM format
    
    // 查找所有待就診且已過期的預約
    const expiredAppointments = await prisma.appointment.findMany({
      where: {
        status: 'PENDING',
        OR: [
          // 日期已過期
          {
            schedule: {
              date: {
                lt: today
              }
            }
          },
          // 今天但時間已過期
          {
            schedule: {
              date: today
            },
            time: {
              lt: currentTime
            }
          }
        ]
      },
      include: {
        schedule: true
      }
    });

    console.log(`Found ${expiredAppointments.length} expired appointments to update`);

    if (expiredAppointments.length === 0) {
      return NextResponse.json({ 
        message: 'No expired appointments to update',
        updatedCount: 0
      });
    }

    // 批量更新為已完成狀態
    const updatePromises = expiredAppointments.map(appointment => 
      prisma.appointment.update({
        where: { id: appointment.id },
        data: { 
          status: 'COMPLETED',
          reason: '自動到期完成就診'
        }
      })
    );

    await Promise.all(updatePromises);

    return NextResponse.json({ 
      message: `Updated ${expiredAppointments.length} expired appointments to COMPLETED status`,
      updatedCount: expiredAppointments.length
    });

  } catch (error) {
    console.error('Error auto-updating appointment statuses:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}