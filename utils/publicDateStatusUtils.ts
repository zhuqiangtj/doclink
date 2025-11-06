import { DateStatus } from '../components/EnhancedDatePicker';
import { convertToDateStatuses } from './dateStatusUtils';

interface TimeSlot {
  startTime: string;
  endTime: string;
  bedCount: number;
  availableBeds: number;
  appointments: Array<{ id: string }>;
}

interface Schedule {
  id: string;
  date: string; // YYYY-MM-DD
  room: { id: string; name: string };
  timeSlots: TimeSlot[];
}

export async function fetchPublicDateStatusesForMonth(
  year: number,
  month: number,
  doctorId: string
): Promise<DateStatus[]> {
  try {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    // 先獲取該月份內有排班的日期
    const overviewRes = await fetch(`/api/public/schedules?doctorId=${doctorId}&month=${monthStr}`);
    if (!overviewRes.ok) throw new Error('Failed to fetch public monthly overview');
    const overviewData = await overviewRes.json();
    const scheduledDates: string[] = overviewData.scheduledDates || [];

    // 對每一天抓取詳情（包含各時段與appointments計數）
    const detailedSchedulesData: { [dateString: string]: Schedule[] } = {};
    const detailPromises = scheduledDates.map(async (dateStr) => {
      const detailsRes = await fetch(`/api/public/schedules?doctorId=${doctorId}&date=${dateStr}`);
      if (detailsRes.ok) {
        const details: Schedule[] = await detailsRes.json();
        detailedSchedulesData[dateStr] = details;
      } else {
        detailedSchedulesData[dateStr] = [];
      }
    });
    await Promise.all(detailPromises);

    // 轉換成 EnhancedDatePicker 需要的狀態
    const highlightedDates = scheduledDates.map((dateStr) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y || 0, (m || 1) - 1, d || 1);
    });

    return convertToDateStatuses(highlightedDates, detailedSchedulesData);
  } catch (error) {
    console.error('Error fetching public date statuses:', error);
    return [];
  }
}