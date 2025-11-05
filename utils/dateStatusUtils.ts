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
  const now = new Date();
  today.setHours(0, 0, 0, 0);

  return highlightedDates.map(date => {
    const dateStr = formatDateToYYYYMMDD(date);
    const isDateBeforeToday = date < today;

    // 獲取該日期的排班數據
    const daySchedules = schedulesData?.[dateStr] || [];
    // 按照需求：統計「當天所有時段」的數據（不論是否已過期）
    const daySlots: TimeSlot[] = [];
    for (const schedule of daySchedules) {
      for (const slot of schedule.timeSlots) {
        daySlots.push(slot);
      }
    }

    // 計算當天總床位與已預約數量
    // 需求：已預約數量為「所有時段的已預約總數」（不管是否過期）
    // 使用 appointments.length 更精準地表達已預約數量
    let totalBeds = 0;
    let bookedBeds = 0;
    for (const slot of daySlots) {
      totalBeds += Number(slot.bedCount) || 0;
      const bookedForSlot = Array.isArray(slot.appointments) ? slot.appointments.length : Math.max(0, (Number(slot.bedCount) || 0) - (Number(slot.availableBeds) || 0));
      bookedBeds += bookedForSlot;
    }

    const hasAppointments = bookedBeds > 0;
    // 若今日所有時段均已結束，或日期早於今天，視為「已過期」
    // 這裡保留 isPast 的判定，但不影響統計的顯示（角標將始終顯示數字）
    const allSlotsEndedToday = (() => {
      if (date.toDateString() !== today.toDateString()) return false;
      // 若今日但所有槽位的結束時間均在「現在」之前，視為已過期
      if (daySlots.length === 0) return true;
      return daySlots.every(slot => {
        const slotEnd = new Date(`${dateStr}T${slot.endTime}:00`);
        return slotEnd <= now;
      });
    })();
    const isPast = isDateBeforeToday || allSlotsEndedToday;

    return {
      date: dateStr,
      // 該日期只要存在任何時段，即視為「有排班」
      hasSchedule: daySlots.length > 0,
      hasAppointments,
      // 將右下角標示為 已預約數量/總床位數
      bookedBeds,
      totalBeds,
      isPast,
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
    const highlightedDates = schedulesData.scheduledDates.map((dateStr: string) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y || 0, (m || 1) - 1, d || 1);
    });

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
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 從 YYYY-MM-DD 字符串創建Date對象
 */
export function parseDateFromYYYYMMDD(dateString: string): Date {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(y || 0, (m || 1) - 1, d || 1);
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