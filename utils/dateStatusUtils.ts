import { DateStatus } from '../components/EnhancedDatePicker';

interface Schedule {
  id: string;
  date: string;
  room: { id: string; name: string; bedCount: number };
  timeSlots: {
    time: string;
    total: number;
    appointments: Array<{
      id: string;
      patient: { user: { name: string } };
      user: { name: string; role: string };
      status: string;
      time: string;
    }>;
  }[];
}

/**
 * 轉換排班數據為日期狀態數據
 * @param highlightedDates 有排班的日期列表
 * @param schedulesData 所有排班數據（可選，用於獲取預約信息）
 * @returns DateStatus數組
 */
export function convertToDateStatuses(
  highlightedDates: Date[],
  schedulesData?: { [dateString: string]: Schedule[] }
): DateStatus[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return highlightedDates.map(date => {
    const dateStr = formatDateToYYYYMMDD(date);
    const isPast = date < today;
    
    // 獲取該日期的排班數據
    const daySchedules = schedulesData?.[dateStr] || [];
    
    // 計算總時段數和預約數
    let totalSlots = 0;
    let appointmentCount = 0;
    let hasAppointments = false;

    daySchedules.forEach(schedule => {
      schedule.timeSlots.forEach(slot => {
        totalSlots++;
        const slotAppointments = slot.appointments.filter(apt => 
          apt.status !== 'CANCELLED' && apt.status !== 'REJECTED'
        );
        appointmentCount += slotAppointments.length;
        if (slotAppointments.length > 0) {
          hasAppointments = true;
        }
      });
    });

    return {
      date: dateStr,
      hasSchedule: true, // 因為這些都是有排班的日期
      hasAppointments,
      appointmentCount,
      totalSlots,
      isPast
    };
  });
}

/**
 * 獲取指定月份的日期狀態數據
 * @param year 年份
 * @param month 月份 (0-11)
 * @param doctorId 醫生ID
 * @returns Promise<DateStatus[]>
 */
export async function fetchDateStatusesForMonth(
  year: number,
  month: number,
  doctorId?: string
): Promise<DateStatus[]> {
  try {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    // 獲取該月份有排班的日期
    const schedulesRes = await fetch(`/api/schedules?month=${monthStr}`);
    if (!schedulesRes.ok) {
      throw new Error('Failed to fetch schedules');
    }
    const schedulesData = await schedulesRes.json();
    
    // 轉換日期字符串為Date對象
    const highlightedDates = schedulesData.scheduledDates.map((dateStr: string) => 
      new Date(dateStr + 'T00:00:00')
    );

    // 獲取每個日期的詳細排班和預約信息
    const detailedSchedulesData: { [dateString: string]: Schedule[] } = {};
    
    // 批量獲取所有日期的詳細信息
    const detailPromises = schedulesData.scheduledDates.map(async (dateStr: string) => {
      try {
        const detailsRes = await fetch(`/api/schedules/details?date=${dateStr}`);
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          detailedSchedulesData[dateStr] = details;
        }
      } catch (error) {
        console.warn(`Failed to fetch details for date ${dateStr}:`, error);
        detailedSchedulesData[dateStr] = [];
      }
    });

    await Promise.all(detailPromises);

    return convertToDateStatuses(highlightedDates, detailedSchedulesData);
  } catch (error) {
    console.error('Error fetching date statuses:', error);
    return [];
  }
}

/**
 * 格式化日期為 YYYY-MM-DD 字符串
 */
export function formatDateToYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * 從 YYYY-MM-DD 字符串創建Date對象
 */
export function parseDateFromYYYYMMDD(dateString: string): Date {
  return new Date(dateString + 'T00:00:00');
}

/**
 * 檢查日期是否為今天
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

/**
 * 檢查日期是否為過去
 */
export function isPastDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate < today;
}