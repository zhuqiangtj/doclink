import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { createAuditLog } from '../../../../lib/audit';
import { createAppointmentHistoryInTransaction } from '../../../../lib/appointment-history';
import { publishDoctorEvent, publishPatientEvent } from '@/lib/realtime';

// PUT - 更新预约状态
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

// 验证状态值
    const validStatuses = ['PENDING', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

// 获取预约信息
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

// 权限检查
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
// 当日取消，视为爽约
finalReason = '病人当天取消预约';
        credibilityChange = -5;
      } else if (appointmentDate > today) {
// 提前取消
finalReason = '病人预约日之前提前取消';
      } else {
return NextResponse.json({ error: '无法取消已过期的预约' }, { status: 400 });
      }
    } else if (status === 'NO_SHOW' && appointment.status === 'COMPLETED') {
// 医生标记爽约
finalReason = '医生确认爽约';
      credibilityChange = -5;
    } else if (status === 'COMPLETED' && appointment.status === 'PENDING') {
      // 自動完成
      finalReason = finalReason || '自動到期完成就診';
    }

// 更新预约状态
    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: { 
          status: status as any,
          reason: finalReason 
        }
      });

// 创建预约历史记录
      await createAppointmentHistoryInTransaction(tx, {
        appointmentId: appointmentId,
        operatorName: session.user.name || session.user.username || 'Unknown',
        operatorId: session.user.id,
        status: status as any,
        reason: finalReason,
        action: `UPDATE_STATUS_TO_${status}`,
      });

// 如果需要扣分，更新病人信用分数
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

// 记录审计日志
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

    // Publish realtime status update events
    try {
      await Promise.all([
        publishDoctorEvent(appointment.doctorId, 'APPOINTMENT_STATUS_UPDATED', {
          appointmentId,
          timeSlotId: appointment.timeSlotId,
          oldStatus: appointment.status,
          newStatus: status,
          actorRole: session.user.role,
          reason: finalReason,
        }),
        publishPatientEvent(appointment.patientId, 'APPOINTMENT_STATUS_UPDATED', {
          appointmentId,
          timeSlotId: appointment.timeSlotId,
          oldStatus: appointment.status,
          newStatus: status,
          actorRole: session.user.role,
          reason: finalReason,
        }),
      ]);
    } catch (e) {
      console.error('[Realtime] APPOINTMENT_STATUS_UPDATED publish failed', e);
    }
    return NextResponse.json(updatedAppointment);

  } catch (error) {
    console.error('Error updating appointment status:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST - 自动更新过期预约状态
// 共享的自動更新邏輯，供 POST/GET 調用（兼容 Vercel Cron）
async function autoUpdateExpiredAppointments(context?: { requestId?: string }) {
  try {
    const now = new Date();
    const reqId = context?.requestId || 'none';
    // 時區解析：兼容像 ":UTC" 的值，並提供安全回退
    const tzRaw = process.env.APP_TIMEZONE || process.env.TZ;
    let tzCandidate = tzRaw?.trim();
    if (tzCandidate?.startsWith(':')) {
      tzCandidate = tzCandidate.slice(1);
    }
    const pickSafeTz = (candidate?: string): string | undefined => {
      if (!candidate) return undefined;
      try {
// 验证候选时区是否为有效 IANA 名称
        new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(now);
        return candidate;
      } catch {
        return undefined;
      }
    };
    // 在中國北京使用：優先 Asia/Shanghai，其次使用候選值，再回退 UTC
    const tz = pickSafeTz(tzCandidate) || pickSafeTz('Asia/Shanghai') || 'UTC';
    console.log(`[appointments/status][auto] start reqId=${reqId} tzRaw=${tzRaw ?? 'undefined'} tz=${tz} at=${now.toISOString()}`);

    // 以指定時區生成 YYYY-MM-DD 與 HH:MM 字串，避免 Vercel UTC 造成誤判
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const currentTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);

// 查找所有待就诊且已过期的预约（以所属时段的开始时间判断过期）
    const expiredAppointments = await prisma.appointment.findMany({
      where: {
        status: 'PENDING',
        OR: [
          // 日期已過期
          {
            schedule: {
              date: {
                lt: today,
              },
            },
          },
// 今天且时段开始时间已过期
          {
            schedule: { date: today },
            timeSlot: { startTime: { lt: currentTime } },
          },
        ],
      },
      include: {
        schedule: true,
        timeSlot: true,
      },
    });

    console.log(`[appointments/status][auto] found=${expiredAppointments.length} tz=${tz} today=${today} time=${currentTime} reqId=${reqId}`);

    if (expiredAppointments.length === 0) {
      return NextResponse.json({
        message: 'No expired appointments to update',
        updatedCount: 0,
        requestId: reqId,
      });
    }

// 批量更新为已完成状态并新增历史记录（幂等：仅 PENDING -> COMPLETED）
    for (const appointment of expiredAppointments) {
      await prisma.$transaction(async (tx) => {
// 更新主记录状态与原因
        await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: 'COMPLETED',
            reason: '系統自動觸發：日期到期',
          },
        });

// 新增历史记录（操作时间为函数触发时间）
        await tx.appointmentHistory.create({
          data: {
            appointmentId: appointment.id,
            operatorName: '系統',
            operatorId: null,
            operatedAt: new Date(),
            status: 'COMPLETED',
            reason: '系統自動觸發：日期到期',
            action: 'UPDATE_STATUS_TO_COMPLETED',
          },
        });
      });
    }

    console.log(`[appointments/status][auto] completed updatedCount=${expiredAppointments.length} reqId=${reqId}`);
    return NextResponse.json({
      message: `Updated ${expiredAppointments.length} expired appointments to COMPLETED status`,
      updatedCount: expiredAppointments.length,
      requestId: reqId,
    });
  } catch (error) {
    const reqId = context?.requestId || 'none';
    console.error(`[appointments/status][auto] error reqId=${reqId}:`, error);
    return NextResponse.json({ error: 'Internal Server Error', requestId: reqId }, { status: 500 });
  }
}

// POST - 自动更新过期预约状态（手动/本地脚本）
export async function POST() {
  return autoUpdateExpiredAppointments();
}

// GET - 供 Vercel Cron 調用
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const reqId = (globalThis as any).crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  const hasSecret = !!secret;
  const hasAuth = !!authHeader;
  const authOk = hasSecret ? authHeader === `Bearer ${secret}` : true;

  console.log(`[appointments/status][GET] reqId=${reqId} hasSecret=${hasSecret} hasAuth=${hasAuth} authOk=${authOk}`);

// 若设置了 CRON_SECRET，则要求 Authorization: Bearer <CRON_SECRET>
  if (hasSecret && !authOk) {
    console.warn(`[appointments/status][GET] unauthorized reqId=${reqId}`);
    return NextResponse.json({ error: 'Unauthorized', requestId: reqId }, { status: 401 });
  }

  const res = await autoUpdateExpiredAppointments({ requestId: reqId });
  try {
    res.headers.set('X-Request-ID', reqId);
  } catch {
    // ignore header set failure
  }
  return res;
}