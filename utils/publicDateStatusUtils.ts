import { DateStatus } from '../components/EnhancedDatePicker';
import { convertToDateStatuses } from './dateStatusUtils';
import { fetchWithTimeout } from './network';

// 月度緩存：doctorId + YYYY-MM -> DateStatus[]
const monthCache = new Map<string, DateStatus[]>();
const keyFor = (doctorId: string, year: number, month: number) => `${doctorId}:${year}-${String(month + 1).padStart(2, '0')}`;

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
  room: { id: string; name: string; bedCount?: number };
  timeSlots: TimeSlot[];
}

export async function fetchPublicDateStatusesForMonth(
  year: number,
  month: number,
  doctorId: string
): Promise<DateStatus[]> {
  const cacheKey = keyFor(doctorId, year, month);
  const cached = monthCache.get(cacheKey);
  if (cached) return cached;

  try {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    // 單次請求獲取整月詳細時段（aggregate=1），前端自行分組
    const aggregateRes = await fetchWithTimeout(`/api/public/schedules?doctorId=${doctorId}&month=${monthStr}&aggregate=1`, { cache: 'no-store' });
    if (!aggregateRes.ok) throw new Error('Failed to fetch public monthly aggregated details');
    const aggregateData: { scheduledDates: string[]; schedules: Schedule[] } = await aggregateRes.json();
    const scheduledDates: string[] = aggregateData.scheduledDates || [];

    // 分組為按日期的詳細資料
    const detailedSchedulesData: { [dateString: string]: Schedule[] } = {};
    for (const s of (aggregateData.schedules || [])) {
      if (!detailedSchedulesData[s.date]) detailedSchedulesData[s.date] = [];
      detailedSchedulesData[s.date].push(s);
    }

    const highlightedDates = scheduledDates.map((dateStr) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y || 0, (m || 1) - 1, d || 1);
    });

    const statuses = convertToDateStatuses(highlightedDates, detailedSchedulesData);
    monthCache.set(cacheKey, statuses);
    return statuses;
  } catch (error) {
    console.error('Error fetching public date statuses:', error);
    return [];
  }
}

// 預取相鄰月份：把結果放入緩存，不改變 UI 狀態
export async function prefetchPublicMonthStatuses(year: number, month: number, doctorId: string): Promise<void> {
  const cacheKey = keyFor(doctorId, year, month);
  if (monthCache.has(cacheKey)) return;
  try {
    await fetchPublicDateStatusesForMonth(year, month, doctorId);
    // fetchPublicDateStatusesForMonth 本身會寫入緩存
  } catch {
    // 静默失败：预取不影响当前 UI
  }
}

export function invalidatePublicMonthCache(doctorId: string, year: number, month: number): void {
  const cacheKey = keyFor(doctorId, year, month);
  monthCache.delete(cacheKey);
}
