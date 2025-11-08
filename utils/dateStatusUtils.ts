import { DateStatus } from '../components/EnhancedDatePicker';

interface Appointment {
  id: string;
  // minimal shape used here
}

interface TimeSlot {
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  bedCount: number;
  availableBeds: number;
  appointments: Appointment[];
}

interface Schedule {
  id: string;
  date: string; // YYYY-MM-DD
  room: { id: string; name: string; bedCount: number };
  timeSlots: TimeSlot[];
}

/**
 * 转换排班数据为日期状态数据
 * @param highlightedDates 有排班的日期列表
 * @param schedulesData 所有排班数据（可选，用于获取预约信息）
 * @returns DateStatus 数组
 */
export function convertToDateStatuses(
  highlightedDates: Date[],
  schedulesData?: { [dateString: string]: Schedule[] }
): DateStatus[] {
  const today = new Date();
  const now = new Date();
  today.setHours(0, 0, 0, 0);

  return highlightedDates.map(date => {
    const dateStr = formatDateToYYYYMMDD(date);
    const isDateBeforeToday = date < today;

    // 获取该日期的排班数据
    const daySchedules = schedulesData?.[dateStr] || [];
// 按照需求：统计「当天所有时段」的数据（不论是否已过期）
    const daySlots: TimeSlot[] = [];
    for (const schedule of daySchedules) {
      for (const slot of schedule.timeSlots) {
        daySlots.push(slot);
      }
    }

// 计算当天总床位与已预约数量
// 需求：已预约数量为「所有时段的已预约总数」（不管是否过期）
// 使用 appointments.length 更精准地表达已预约数量
    let totalBeds = 0;
    let bookedBeds = 0;
    for (const slot of daySlots) {
      totalBeds += Number(slot.bedCount) || 0;
      const bookedForSlot = Array.isArray(slot.appointments) ? slot.appointments.length : Math.max(0, (Number(slot.bedCount) || 0) - (Number(slot.availableBeds) || 0));
      bookedBeds += bookedForSlot;
    }

    const hasAppointments = bookedBeds > 0;
// 若今日所有时段均已结束，或日期早于今天，视为「已过期」
    // 这里保留 isPast 的判定，但不影响统计的显示（角标将始终显示数字）
    const allSlotsEndedToday = (() => {
      if (date.toDateString() !== today.toDateString()) return false;
// 若今日但所有槽位的结束时间均在「现在」之前，视为已过期
      if (daySlots.length === 0) return true;
      return daySlots.every(slot => {
        const slotEnd = new Date(`${dateStr}T${slot.endTime}:00`);
        return slotEnd <= now;
      });
    })();
    const isPast = isDateBeforeToday || allSlotsEndedToday;

    return {
      date: dateStr,
// 该日期只要存在任何时段，即视为「有排班」
      hasSchedule: daySlots.length > 0,
      hasAppointments,
// 将右下角标示为 已预约数量/总床位数
      bookedBeds,
      totalBeds,
      isPast,
    };
  });
}

/**
 * 获取指定月份的日期状态数据
 * @param year 年份
 * @param month 月份 (0-11)
 * @param doctorId 医生 ID
 * @returns Promise<DateStatus[]>
 */
export async function fetchDateStatusesForMonth(
  year: number,
  month: number,
  doctorId?: string
): Promise<DateStatus[]> {
  try {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    
    // 获取该月份有排班的日期
    const schedulesRes = await fetch(`/api/schedules?month=${monthStr}`);
    if (!schedulesRes.ok) {
      throw new Error('Failed to fetch schedules');
    }
    const schedulesData = await schedulesRes.json();
    
    // 转换日期字符串为 Date 对象
    const highlightedDates = schedulesData.scheduledDates.map((dateStr: string) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y || 0, (m || 1) - 1, d || 1);
    });

    // 获取每个日期的详细排班和预约信息
    const detailedSchedulesData: { [dateString: string]: Schedule[] } = {};
    
    // 批量获取所有日期的详细信息
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
 * 格式化日期为 YYYY-MM-DD 字符串
 */
export function formatDateToYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 从 YYYY-MM-DD 字符串创建 Date 对象
 */
export function parseDateFromYYYYMMDD(dateString: string): Date {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(y || 0, (m || 1) - 1, d || 1);
}

/**
 * 检查日期是否为今天
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

/**
 * 检查日期是否为过去
 */
export function isPastDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate < today;
}