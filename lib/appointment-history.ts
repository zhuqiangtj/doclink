import { AppointmentStatus } from '@prisma/client';
import { prisma } from './prisma';

interface CreateHistoryParams {
  appointmentId: string;
  operatorName: string;
  operatorId?: string;
  status: AppointmentStatus;
  reason?: string;
  action: string;
}

/**
 * 創建預約歷史記錄
 * @param params 歷史記錄參數
 */
export async function createAppointmentHistory(params: CreateHistoryParams) {
  const { appointmentId, operatorName, operatorId, status, reason, action } = params;
  
  try {
    const history = await prisma.appointmentHistory.create({
      data: {
        appointmentId,
        operatorName,
        operatorId,
        status,
        reason,
        action,
      },
    });
    
    console.log(`[APPOINTMENT_HISTORY] Created history record for appointment ${appointmentId}: ${action} by ${operatorName}`);
    return history;
  } catch (error) {
    console.error('[APPOINTMENT_HISTORY] Error creating history record:', error);
    throw error;
  }
}

/**
 * 獲取預約的所有歷史記錄
 * @param appointmentId 預約ID
 */
export async function getAppointmentHistory(appointmentId: string) {
  try {
    const history = await prisma.appointmentHistory.findMany({
      where: { appointmentId },
      orderBy: { operatedAt: 'asc' }, // 按時間順序排列
    });
    
    return history;
  } catch (error) {
    console.error('[APPOINTMENT_HISTORY] Error fetching history:', error);
    throw error;
  }
}

/**
 * 在事務中創建預約歷史記錄
 * @param tx Prisma事務客戶端
 * @param params 歷史記錄參數
 */
export async function createAppointmentHistoryInTransaction(
  tx: any, // Prisma transaction client
  params: CreateHistoryParams
) {
  const { appointmentId, operatorName, operatorId, status, reason, action } = params;
  
  try {
    const history = await tx.appointmentHistory.create({
      data: {
        appointmentId,
        operatorName,
        operatorId,
        status,
        reason,
        action,
      },
    });
    
    console.log(`[APPOINTMENT_HISTORY] Created history record in transaction for appointment ${appointmentId}: ${action} by ${operatorName}`);
    return history;
  } catch (error) {
    console.error('[APPOINTMENT_HISTORY] Error creating history record in transaction:', error);
    throw error;
  }
}