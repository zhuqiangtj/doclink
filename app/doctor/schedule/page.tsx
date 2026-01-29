'use client';

import { useState, useEffect, useCallback, FormEvent, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import CancelAppointmentModal from '../../../components/CancelAppointmentModal';
import PatientDetailModal from '../../../components/PatientDetailModal';
import AppointmentSymptomModal from '../../../components/AppointmentSymptomModal';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './mobile.css';
import './mobile-overrides.css';
import '../appointments/mobile.css';
import { getStatusText } from '../../../utils/statusText';
import { FaTrash, FaSave, FaUserPlus, FaPlusCircle, FaHistory } from 'react-icons/fa';
import EnhancedDatePicker, { DateStatus } from '../../../components/EnhancedDatePicker';
import { fetchDateStatusesForMonth, isPastDate } from '../../../utils/dateStatusUtils';
import { fetchWithTimeout } from '../../../utils/network';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; isPrivate?: boolean; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface Appointment { 
  id: string; 
  patient: { 
    id: string;
    user: { name: string; gender?: string; dateOfBirth?: string; phone?: string }, 
    credibilityScore?: number,
  }; 
  user: { name: string; role: string }; 
  status: string; 
  time: string;
  timeSlot?: { startTime: string; endTime: string; };
  reason?: string;
  symptoms?: string;
  treatmentPlan?: string;
  history?: Array<{ operatedAt: string; operatorName: string; }>;
}
interface TimeSlot { 
  id: string;
  startTime: string; 
  endTime: string;
  bedCount: number;
  availableBeds: number;
  type: 'MORNING' | 'AFTERNOON';
  isActive: boolean;
  appointments: Appointment[]; 
}
interface Schedule {
  id: string;
  date: string;
  room: Room;
  timeSlots: TimeSlot[];
}

const dedupeSchedulesByRoom = (arr: Schedule[]): Schedule[] => {
  const map = new Map<string, Schedule>();
  for (const s of arr || []) {
    const key = s?.room?.id || s.id;
    const existing = map.get(key);
    if (!existing) {
      const slots = [...(s.timeSlots || [])].sort((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(key, { ...s, timeSlots: slots });
    } else {
      const slotsMap = new Map<string, TimeSlot>();
      for (const t of existing.timeSlots || []) slotsMap.set(t.id, t);
      for (const t of s.timeSlots || []) slotsMap.set(t.id, t);
      const mergedSlots = Array.from(slotsMap.values()).sort((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(key, { ...existing, timeSlots: mergedSlots });
    }
  }
  return Array.from(map.values());
};
interface PatientSearchResult { id: string; userId: string; name: string; username: string; phone?: string | null; credibilityScore?: number; gender?: string | null; dateOfBirth?: string | null; }

const DEFAULT_TIMES = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

const DEFAULT_TEMPLATE = [
  { startTime: "08:00", endTime: "09:00", bedCount: 4, type: "MORNING" },
  { startTime: "09:00", endTime: "10:00", bedCount: 4, type: "MORNING" },
  { startTime: "10:00", endTime: "10:30", bedCount: 3, type: "MORNING" },
  { startTime: "10:30", endTime: "11:00", bedCount: 2, type: "MORNING" },
  { startTime: "13:30", endTime: "14:30", bedCount: 4, type: "AFTERNOON" },
  { startTime: "14:30", endTime: "15:30", bedCount: 4, type: "AFTERNOON" },
  { startTime: "15:30", endTime: "16:00", bedCount: 3, type: "AFTERNOON" }
];

// --- Timezone-Safe Helper Functions ---
const toYYYYMMDD = (date: Date | null): string => {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const fromYYYYMMDD = (dateString: string): Date => {
  const parts = dateString.split('-').map(part => parseInt(part, 10));
  return new Date(parts[0], parts[1] - 1, parts[2]);
};

// 將 YYYY-MM-DD 字串格式化為本地日期顯示
const formatDate = (dateString: string): string => {
  try {
    const d = fromYYYYMMDD(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return dateString;
  }
};

// 根據出生日期計算年齡（歲）
const calcAgeFromBirthDate = (birthDate?: string): number | null => {
  if (!birthDate) return null;
  try {
    const d = new Date(birthDate);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age >= 0 ? age : null;
  } catch {
    return null;
  }
};

// 以積分決定顏色類名，與全局 PatientCreditBadge 門檻保持一致
const getCreditColorClass = (score?: number | null): 'credit-good' | 'credit-medium' | 'credit-low' | 'credit-neutral' => {
  if (score == null) return 'credit-neutral';
  if (score >= 15) return 'credit-good';
  if (score >= 10) return 'credit-medium';
  return 'credit-low';
};

const getGenderInfo = (gender?: string): { text: string; className: 'gender-male' | 'gender-female' | 'gender-other' } => {
  const g = (gender || '').toUpperCase();
  if (g === 'MALE' || g === 'M') return { text: '男', className: 'gender-male' };
  if (g === 'FEMALE' || g === 'F') return { text: '女', className: 'gender-female' };
  return { text: '其他', className: 'gender-other' };
};

// 判斷時間點是否已過
const isTimeSlotPast = (date: Date, time: string): boolean => {
  // 檢查 time 參數是否有效
  if (!time || typeof time !== 'string') {
    return false; // 如果時間無效，默認不禁用
  }
  
  const now = new Date();
  const slotDateTime = new Date(date);
  
  // 檢查時間格式是否正確
  if (!time.includes(':')) {
    return false;
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  
  // 檢查解析的時間是否有效
  if (isNaN(hours) || isNaN(minutes)) {
    return false;
  }
  
  slotDateTime.setHours(hours, minutes, 0, 0);
  
  // 到點（開始時間）即視為過期
  return slotDateTime <= now;
};

const isKnownStatus = (s: string): s is 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' => {
  return s === 'PENDING' || s === 'COMPLETED' || s === 'CANCELLED' || s === 'NO_SHOW';
};

const normalizeStatus = (status: string): 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' => {
  if (isKnownStatus(status)) return status;
  if (status === 'CHECKED_IN' || status === 'CONFIRMED') return 'PENDING';
  return 'PENDING';
};

// --- Component ---
export default function DoctorSchedulePage() {
  const { data: session, status } = useSession();
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [dateStatuses, setDateStatuses] = useState<DateStatus[]>([]);
  const [highlightedDates, setHighlightedDates] = useState<Date[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [selectedRoomIdForTemplate, setSelectedRoomIdForTemplate] = useState<string>('');
  const selectedRoomIdForTemplateRef = useRef(selectedRoomIdForTemplate);
  const [isTemplateApplying, setIsTemplateApplying] = useState(false);
  const [isAddingTimeSlot, setIsAddingTimeSlot] = useState(false);
  const [modifiedTimeSlots, setModifiedTimeSlots] = useState<Set<string>>(new Set());
  const [savingTimeSlots, setSavingTimeSlots] = useState<Set<string>>(new Set());
  const [activeRoomTab, setActiveRoomTab] = useState<string>('');
  const activeRoomTabRef = useRef(activeRoomTab);
  const [expandedTimeSlots, setExpandedTimeSlots] = useState<Set<string>>(new Set());
  useEffect(() => {
    selectedRoomIdForTemplateRef.current = selectedRoomIdForTemplate;
  }, [selectedRoomIdForTemplate]);

  useEffect(() => {
    activeRoomTabRef.current = activeRoomTab;
  }, [activeRoomTab]);

  const [expandedActionRows, setExpandedActionRows] = useState<Set<string>>(new Set());
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isBookingSubmitting, setIsBookingSubmitting] = useState(false);
  const [selectedScheduleForBooking, setSelectedScheduleForBooking] = useState<Schedule | null>(null);
  const [selectedSlotIndexForBooking, setSelectedSlotIndexForBooking] = useState<number | null>(null);
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [searchedPatients, setSearchedPatients] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [isAddTimeSlotModalOpen, setIsAddTimeSlotModalOpen] = useState(false);
  const [newTimeSlotData, setNewTimeSlotData] = useState({ startTime: '', endTime: '', bedCount: '' });
  const [collapsedSlots, setCollapsedSlots] = useState<{[key: string]: boolean}>({});
  const [editingSlots, setEditingSlots] = useState<{[key: string]: any}>({});
  const [deletingSlots, setDeletingSlots] = useState<Set<string>>(new Set());
  // 注意：統一使用 savingTimeSlots 來追蹤各時段的保存狀態
  const [savingSlots, setSavingSlots] = useState<Set<string>>(new Set());
  // 取消預約模態框狀態
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [selectedAppointmentForCancel, setSelectedAppointmentForCancel] = useState<{
    appointmentId: string;
    scheduleId: string;
    slotIndex: number;
    patientName: string;
    date: string;
    time: string;
    roomName: string;
    credibilityScore?: number | null;
  } | null>(null);
  const [overlayText, setOverlayText] = useState<string | null>(null);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorDialogText, setErrorDialogText] = useState<string | null>(null);
  const selectedDateRef = useRef<Date | null>(selectedDate);
  const fetchAllDataForDateRef = useRef<((date: Date | null) => Promise<void>) | undefined>(undefined);
  const refreshTimeSlotByIdRef = useRef<((id: string) => Promise<void>) | undefined>(undefined);
  const templateApplyGateRef = useRef<boolean>(false);
  const fetchRequestIdRef = useRef<number>(0);
  const monthFetchRequestIdRef = useRef<number>(0);

  const refreshMonthStatuses = useCallback(async () => {
    if (status === 'authenticated' && doctorProfile) {
      const requestId = ++monthFetchRequestIdRef.current;
      try {
        const dateStatusData = await fetchDateStatusesForMonth(
          currentMonth.getFullYear(),
          currentMonth.getMonth(),
          doctorProfile.id
        );
        if (requestId === monthFetchRequestIdRef.current) {
          setDateStatuses(dateStatusData);
        }
      } catch (error) {
        console.error('Error fetching date statuses:', error);
      }
    }
  }, [status, doctorProfile, currentMonth]);

  const refreshSingleDateStatus = useCallback(async (dateVal: Date | null) => {
    if (status !== 'authenticated' || !doctorProfile?.id || !dateVal) return;
    const dateStr = toYYYYMMDD(dateVal);
    try {
      const detailsRes = await fetchWithTimeout(`/api/schedules/details?date=${dateStr}`, { cache: 'no-store' });
      if (!detailsRes.ok) return;
      const details: Schedule[] = await detailsRes.json();
      const totals = details.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
        for (const ts of sch.timeSlots || []) {
          acc.totalBeds += Number(ts.bedCount || 0);
          const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
          acc.bookedBeds += used > 0 ? used : 0;
        }
        return acc;
      }, { bookedBeds: 0, totalBeds: 0 });
      const updatedStatus = {
        date: dateStr,
        hasSchedule: details.some(s => (s.timeSlots || []).length > 0),
        hasAppointments: totals.bookedBeds > 0,
        bookedBeds: totals.bookedBeds,
        totalBeds: totals.totalBeds,
        isPast: isPastDate(dateVal),
      };
      setDateStatuses(prevStatuses => {
        const idx = prevStatuses.findIndex(st => st.date === dateStr);
        if (idx >= 0) {
          const copy = [...prevStatuses];
          copy[idx] = updatedStatus;
          return copy;
        }
        return [...prevStatuses, updatedStatus];
      });
    } catch {}
  }, [status, doctorProfile]);

  const handleCalendarMonthChange = useCallback(async (year: number, month: number) => {
    if (status !== 'authenticated' || !doctorProfile?.id) return;
    
    // Invalidate any ongoing data fetches for selected date to prevent stale data display
    fetchRequestIdRef.current += 1;

    setIsLoading(true);
    setIsNetworkError(false);
    setError(null);

    // 切換月份時，清空當前選中的日期和排班列表
    setSelectedDate(null);
    setSchedulesForSelectedDay([]);
    selectedDateRef.current = null;

    try {
      setCurrentMonth(new Date(year, month, 1));
      const dateStatusData = await fetchDateStatusesForMonth(year, month, doctorProfile.id);
      setDateStatuses(dateStatusData);
    } catch (error) {
      console.error('Month change refresh failed:', error);
      setIsNetworkError(true);
      setError('无法加载排班数据，请检查网络连接');
    } finally {
      setIsLoading(false);
    }
  }, [status, doctorProfile?.id]);

  const getSlotValue = (scheduleId: string, slotIndex: number, field: 'startTime' | 'endTime' | 'bedCount' | 'type' | 'roomId', originalValue: any) => {
    const key = `${scheduleId}-${slotIndex}`;
    return editingSlots[key]?.[field] ?? originalValue;
  };

  const updateSlotEdit = (scheduleId: string, slotIndex: number, field: 'startTime' | 'endTime' | 'bedCount' | 'type' | 'roomId', value: string | number) => {
    const key = `${scheduleId}-${slotIndex}`;
    setEditingSlots(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }));
  };

  const refreshTimeSlotById = useCallback(async (id: string) => {
    try {
      const res = await fetchWithTimeout(`/api/schedules/details?timeSlotId=${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const arr = await res.json();
      const updatedSchedule = Array.isArray(arr) ? arr[0] : null;
      if (!updatedSchedule || !updatedSchedule.timeSlots || updatedSchedule.timeSlots.length === 0) return;
      const updatedSlot = updatedSchedule.timeSlots[0];
      
      // 使用 Ref 獲取當前選中的日期，確保在異步操作後狀態判定準確
      if (!selectedDateRef.current) return;
      const currentSelectedDateStr = toYYYYMMDD(selectedDateRef.current);

      try {
        const dayRes = await fetchWithTimeout(`/api/schedules/details?date=${updatedSchedule.date}`, { cache: 'no-store' });
        if (dayRes.ok) {
          const detailsData: Schedule[] = await dayRes.json();
          const totals = detailsData.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
            for (const ts of sch.timeSlots || []) {
              acc.totalBeds += Number(ts.bedCount || 0);
              const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
              acc.bookedBeds += used > 0 ? used : 0;
            }
            return acc;
          }, { bookedBeds: 0, totalBeds: 0 });
          const d = fromYYYYMMDD(updatedSchedule.date);
          const updatedStatus = {
            date: updatedSchedule.date,
            hasSchedule: detailsData.some(s => (s.timeSlots || []).length > 0),
            hasAppointments: totals.bookedBeds > 0,
            bookedBeds: totals.bookedBeds,
            totalBeds: totals.totalBeds,
            isPast: isPastDate(d),
          };
          setDateStatuses(prevStatuses => {
            const idx = prevStatuses.findIndex(st => st.date === updatedSchedule.date);
            if (idx >= 0) {
              const copy = [...prevStatuses];
              copy[idx] = updatedStatus;
              return copy;
            }
            return [...prevStatuses, updatedStatus];
          });
        }
      } catch {}

      // 如果更新的排班日期與當前選中日期不一致，則不更新排班列表
      if (updatedSchedule.date !== currentSelectedDateStr) {
        return;
      }

      setSchedulesForSelectedDay(prev => {
        const scheduleExists = prev.some(s => s.id === updatedSchedule.id);
        let slotExists = false;
        const next = prev.map(s => {
          if (s.id === updatedSchedule.id) {
            const has = s.timeSlots.some(t => t.id === updatedSlot.id);
            slotExists = slotExists || has;
            const mergedSlots = has
              ? s.timeSlots.map(t => (t.id === updatedSlot.id ? updatedSlot : t))
              : [...s.timeSlots, updatedSlot].sort((a, b) => a.startTime.localeCompare(b.startTime));
            return { ...s, timeSlots: mergedSlots };
          }
          return s;
        });
        const finalNext = scheduleExists ? next : [...next, updatedSchedule];

        const dateStr = selectedDateStr;
        const totals = finalNext.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
          for (const ts of sch.timeSlots || []) {
            acc.totalBeds += Number(ts.bedCount || 0);
            const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
            acc.bookedBeds += used > 0 ? used : 0;
          }
          return acc;
        }, { bookedBeds: 0, totalBeds: 0 });
        const updatedStatus = {
          date: dateStr,
          hasSchedule: finalNext.some(s => (s.timeSlots || []).length > 0),
          hasAppointments: totals.bookedBeds > 0,
          bookedBeds: totals.bookedBeds,
          totalBeds: totals.totalBeds,
          isPast: isPastDate(selectedDate),
        };
        setDateStatuses(prevStatuses => {
          const idx = prevStatuses.findIndex(st => st.date === dateStr);
          if (idx >= 0) {
            const copy = [...prevStatuses];
            copy[idx] = updatedStatus;
            return copy;
          }
          return [...prevStatuses, updatedStatus];
        });

        return finalNext;
      });
    } catch {}
  }, [selectedDate]);

  const mergeSchedulesGranular = useCallback((prev: Schedule[], next: Schedule[], dateVal: Date | null) => {
    if (!dateVal) return { merged: prev, changed: false };
    const selectedDateStr = toYYYYMMDD(dateVal);
    const nextById = new Map<string, Schedule>();
    for (const s of next) nextById.set(s.id, s);
    let changed = false;
    let merged: Schedule[] = prev.map((s) => {
      const ns = nextById.get(s.id);
      if (!ns) return s;
      const nsSlotsById = new Map<string, TimeSlot>();
      for (const t of ns.timeSlots || []) nsSlotsById.set(t.id, t);
      const prevSlotsById = new Map<string, TimeSlot>();
      for (const t of s.timeSlots || []) prevSlotsById.set(t.id, t);
      const ids = new Set<string>([...prevSlotsById.keys(), ...nsSlotsById.keys()]);
      const updatedSlots: TimeSlot[] = [];
      ids.forEach((id) => {
        const oldSlot = prevSlotsById.get(id);
        const newSlot = nsSlotsById.get(id);
        if (!newSlot && oldSlot) {
          changed = true;
          return;
        }
        if (newSlot && !oldSlot) {
          changed = true;
          updatedSlots.push(newSlot);
          return;
        }
        if (newSlot && oldSlot) {
          const diff = (
            oldSlot.availableBeds !== newSlot.availableBeds ||
            oldSlot.bedCount !== newSlot.bedCount ||
            oldSlot.isActive !== newSlot.isActive ||
            oldSlot.startTime !== newSlot.startTime ||
            oldSlot.endTime !== newSlot.endTime ||
            (Array.isArray(oldSlot.appointments) ? oldSlot.appointments.length : 0) !== (Array.isArray(newSlot.appointments) ? newSlot.appointments.length : 0)
          );
          updatedSlots.push(diff ? newSlot : oldSlot);
          if (diff) changed = true;
        }
      });
      updatedSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
      return { ...s, timeSlots: updatedSlots };
    });
    for (const s of next) {
      if (!prev.some((ps) => ps.id === s.id)) {
        merged.push(s);
        changed = true;
      }
    }
    const deduped = dedupeSchedulesByRoom(merged);
    if (deduped.length !== merged.length) changed = true;
    merged = deduped;
    const totals = merged.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
      for (const ts of sch.timeSlots || []) {
        acc.totalBeds += Number(ts.bedCount || 0);
        const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
        acc.bookedBeds += used > 0 ? used : 0;
      }
      return acc;
    }, { bookedBeds: 0, totalBeds: 0 });
    const updatedStatus = {
      date: selectedDateStr,
      hasSchedule: merged.some((s) => (s.timeSlots || []).length > 0),
      hasAppointments: totals.bookedBeds > 0,
      bookedBeds: totals.bookedBeds,
      totalBeds: totals.totalBeds,
      isPast: isPastDate(dateVal),
    };
    setDateStatuses((prevStatuses) => {
      const idx = prevStatuses.findIndex((st) => st.date === selectedDateStr);
      if (idx >= 0) {
        const copy = [...prevStatuses];
        copy[idx] = updatedStatus;
        return copy;
      }
      return [...prevStatuses, updatedStatus];
    });
    return { merged, changed };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        if (!selectedDateRef.current) return;
        const dateStr = toYYYYMMDD(selectedDateRef.current);
        const res = await fetchWithTimeout(`/api/schedules/details?date=${dateStr}`, { cache: 'no-store' });
        if (!res.ok) return;
        const nextDetails: Schedule[] = await res.json();
        setSchedulesForSelectedDay((prev) => {
          const { merged, changed } = mergeSchedulesGranular(prev, nextDetails, selectedDateRef.current);
          if (changed) setOverlayText('已自动更新');
          return merged;
        });
        await refreshMonthStatuses();
      } catch {}
    };
    timer = setInterval(run, 60000);
    return () => { if (timer) clearInterval(timer); };
  }, [status, mergeSchedulesGranular]);

  const fetchAllDataForDate = useCallback(async (date: Date | null) => {
    if (!date) return;
    // 增加請求計數ID，用於解決競態條件
    const currentRequestId = ++fetchRequestIdRef.current;
    setIsLoading(true);
    setIsNetworkError(false);
    setError(null);
    
    try {
      // 禁用缓存，确保 SSE 事件后立即获取最新数据
      // 优化：如果已有 profile 且未过期，可考虑复用（此处保留每次获取以确保状态最新，但需注意性能）
      const profileRes = await fetchWithTimeout('/api/user', { cache: 'no-store' });
      // 如果请求ID已过期，直接返回，不更新状态
      if (currentRequestId !== fetchRequestIdRef.current) return;

      if (!profileRes.ok) throw new Error('Failed to fetch doctor profile.');
      const userData = await profileRes.json();
      if (!userData.doctorProfile) throw new Error('Doctor profile not found.');
      setDoctorProfile(userData.doctorProfile);

      if (userData.doctorProfile.Room.length > 0 && !selectedRoomIdForTemplateRef.current) {
        setSelectedRoomIdForTemplate(userData.doctorProfile.Room[0].id);
      }

      // 並行發起請求，使用 centralized fetchWithTimeout
      const monthStr = toYYYYMMDD(date).substring(0, 7);
      
      const detailsPromise = fetchWithTimeout(`/api/schedules/details?date=${toYYYYMMDD(date)}`, { 
        cache: 'no-store'
      });

      // 月份高亮數據也視為關鍵路徑，失敗應阻塞操作，避免誤導用戶
      const highlightsPromise = fetchWithTimeout(`/api/schedules?month=${monthStr}`, { 
        cache: 'no-store'
      });

      // 優先等待排班詳情（關鍵數據）
      let detailsRes, highlightsRes;
      try {
        [detailsRes, highlightsRes] = await Promise.all([detailsPromise, highlightsPromise]);
      } catch (err: any) {
        throw err;
      }

      if (currentRequestId !== fetchRequestIdRef.current) return;
      
      // Double check if selectedDate is still valid (it might have been cleared by month change)
      if (!selectedDateRef.current) return;

      if (!detailsRes.ok) throw new Error('Failed to fetch schedule details.');
      if (!highlightsRes.ok) throw new Error('Failed to fetch schedule highlights.');

      const detailsData = await detailsRes.json();
      const highlightsData = await highlightsRes.json();

      if (currentRequestId !== fetchRequestIdRef.current) return;

      // 處理排班詳情
      setSchedulesForSelectedDay(dedupeSchedulesByRoom(detailsData));

      const initialCollapsedState: Record<string, boolean> = {};
      detailsData.forEach((schedule: any) => {
        schedule.timeSlots.forEach((slot: any, index: number) => {
          const key = `${schedule.id}-${index}`;
          initialCollapsedState[key] = true;
        });
      });
      setCollapsedSlots(initialCollapsedState);

      if (detailsData.length > 0) {
        // Check if the currently active room tab is valid for the new data
        const availableRoomIds = new Set(detailsData.map((s: any) => s.room.id));
        const currentActiveRoom = activeRoomTabRef.current;
        if (!currentActiveRoom || !availableRoomIds.has(currentActiveRoom)) {
          setActiveRoomTab(detailsData[0].room.id);
        }
      } else if (userData.doctorProfile?.Room?.length > 0) {
        // 如果當天沒有排班數據，但醫生有診室，確保選中一個診室（優先保持當前，若無效則選第一個）
        const allRoomIds = new Set(userData.doctorProfile.Room.map((r: any) => r.id));
        const currentActiveRoom = activeRoomTabRef.current;
        if (!currentActiveRoom || !allRoomIds.has(currentActiveRoom)) {
          setActiveRoomTab(userData.doctorProfile.Room[0].id);
        }
      }
      
      // 處理高亮日期
      if (highlightsData && Array.isArray(highlightsData.scheduledDates)) {
        setHighlightedDates(highlightsData.scheduledDates.map((dateStr: string) => fromYYYYMMDD(dateStr)));
      } else {
        throw new Error('Invalid highlights data received');
      }
      
      // 關鍵數據已加載，取消 Loading 狀態，讓用戶盡快看到排班
      setIsLoading(false);
      
    } catch (err) {
      if (currentRequestId !== fetchRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'An error occurred while fetching data');
      setIsNetworkError(true);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      // 在切換日期時，清空所有未保存的本地編輯狀態，確保返回該日期時顯示為資料庫值
      setEditingSlots({});
      setModifiedTimeSlots(new Set());
      setSavingTimeSlots(new Set());
      selectedDateRef.current = selectedDate;
      
      if (selectedDate) {
        setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
        fetchAllDataForDate(selectedDate);
      }
    }
  }, [selectedDate, status, fetchAllDataForDate]);

  useEffect(() => {
    fetchAllDataForDateRef.current = fetchAllDataForDate;
  }, [fetchAllDataForDate]);

  useEffect(() => {
    refreshTimeSlotByIdRef.current = refreshTimeSlotById;
  }, [refreshTimeSlotById]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!doctorProfile?.id) return;
    let es: EventSource | null = null;
    let retry = 0;
    let stopped = false;
    let timer: any = null;
    const connect = () => {
      if (stopped) return;
      es = new EventSource(`/api/realtime/subscribe?kind=doctor&id=${doctorProfile.id}`);
      es.onmessage = async (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          const type = evt?.type as string | undefined;
          const payload = evt?.payload as any;
          const timeSlotId = payload?.timeSlotId as string | undefined;
          const actorRole = payload?.actorRole as string | undefined;
          let msg: string | null = null;
          if (type === 'APPOINTMENT_CREATED') msg = '新增预约已同步';
          else if (type === 'APPOINTMENT_CANCELLED') msg = '取消预约已同步';
          else if (type === 'APPOINTMENT_STATUS_UPDATED') msg = '预约状态已同步';
          else if (type === 'TIMESLOT_CREATED') msg = '新增时段已同步';
          else if (type === 'TIMESLOT_UPDATED') msg = '时段修改已同步';
          else if (type === 'TIMESLOT_DELETED') msg = '时段删除已同步';
          else if (type === 'SCHEDULE_CREATED' || type === 'SCHEDULE_UPDATED' || type === 'SCHEDULE_DELETED') msg = '排班已同步';
          const ts = Number(evt?.ts ?? 0);
          const isRecent = Number.isFinite(ts) && (Date.now() - ts) < 15000;
          const isScheduleEvent = type === 'TIMESLOT_CREATED' || type === 'TIMESLOT_UPDATED' || type === 'TIMESLOT_DELETED' || type === 'SCHEDULE_CREATED' || type === 'SCHEDULE_UPDATED' || type === 'SCHEDULE_DELETED';
          if (msg && isRecent && !isScheduleEvent && actorRole !== 'DOCTOR') setOverlayText(msg);
          switch (type) {
            case 'APPOINTMENT_CREATED': {
              if (timeSlotId) {
                if (!selectedDateRef.current) break;
                const selectedDateStr = toYYYYMMDD(selectedDateRef.current);
                setSchedulesForSelectedDay(prev => {
                  const next = prev.map(s => {
                    if (s.date !== selectedDateStr) return s;
                    const has = s.timeSlots.some(t => t.id === timeSlotId);
                    if (!has) return s;
                    return {
                      ...s,
                      timeSlots: s.timeSlots.map(t => {
                        if (t.id !== timeSlotId) return t;
                        const nb = Math.max(0, Number(t.availableBeds || 0) - 1);
                        return { ...t, availableBeds: nb };
                      })
                    };
                  });
                  const totals = next.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
                    for (const ts of sch.timeSlots || []) {
                      acc.totalBeds += Number(ts.bedCount || 0);
                      const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
                      acc.bookedBeds += used > 0 ? used : 0;
                    }
                    return acc;
                  }, { bookedBeds: 0, totalBeds: 0 });
                  const updatedStatus = {
                    date: selectedDateStr,
                    hasSchedule: next.some(s => (s.timeSlots || []).length > 0),
                    hasAppointments: totals.bookedBeds > 0,
                    bookedBeds: totals.bookedBeds,
                    totalBeds: totals.totalBeds,
                    isPast: isPastDate(selectedDateRef.current!),
                  };
                  setDateStatuses(prevStatuses => {
                    const idx = prevStatuses.findIndex(st => st.date === selectedDateStr);
                    if (idx >= 0) {
                      const copy = [...prevStatuses];
                      copy[idx] = updatedStatus;
                      return copy;
                    }
                    return [...prevStatuses, updatedStatus];
                  });
                  return next;
                });
              }
              if (timeSlotId) {
                if (refreshTimeSlotByIdRef.current) {
                  await refreshTimeSlotByIdRef.current(timeSlotId);
                }
              } else {
                if (fetchAllDataForDateRef.current) {
                  await fetchAllDataForDateRef.current(selectedDateRef.current);
                }
              }
              await refreshSingleDateStatus(selectedDateRef.current);
              await refreshMonthStatuses();
              break;
            }
            case 'APPOINTMENT_CANCELLED': {
              const appointmentId = payload?.appointmentId as string | undefined;
              if (!selectedDateRef.current) break;
              const selectedDateStr = toYYYYMMDD(selectedDateRef.current);
              if (appointmentId) {
                setSchedulesForSelectedDay(prev => {
                  const next = prev.map(s => {
                    if (s.date !== selectedDateStr) return s;
                    const updatedSlots = s.timeSlots.map(t => {
                      const has = (t.appointments || []).some(a => a.id === appointmentId);
                      if (!has) return t;
                      const nb = Math.min(Number(t.bedCount || 0), Number(t.availableBeds || 0) + 1);
                      const nextApps = (t.appointments || []).filter(a => a.id !== appointmentId);
                      return { ...t, availableBeds: nb, appointments: nextApps };
                    });
                    return { ...s, timeSlots: updatedSlots };
                  });
                  const totals = next.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
                    for (const ts of sch.timeSlots || []) {
                      acc.totalBeds += Number(ts.bedCount || 0);
                      const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
                      acc.bookedBeds += used > 0 ? used : 0;
                    }
                    return acc;
                  }, { bookedBeds: 0, totalBeds: 0 });
                  const updatedStatus = {
                    date: selectedDateStr,
                    hasSchedule: next.some(s => (s.timeSlots || []).length > 0),
                    hasAppointments: totals.bookedBeds > 0,
                    bookedBeds: totals.bookedBeds,
                    totalBeds: totals.totalBeds,
                    isPast: isPastDate(selectedDateRef.current!),
                  };
                  setDateStatuses(prevStatuses => {
                    const idx = prevStatuses.findIndex(st => st.date === selectedDateStr);
                    if (idx >= 0) {
                      const copy = [...prevStatuses];
                      copy[idx] = updatedStatus;
                      return copy;
                    }
                    return [...prevStatuses, updatedStatus];
                  });
                  return next;
                });
              }
              const sid = payload?.timeSlotId as string | undefined;
              if (sid) {
                if (refreshTimeSlotByIdRef.current) {
                  await refreshTimeSlotByIdRef.current(sid);
                }
              } else {
                if (fetchAllDataForDateRef.current) {
                  await fetchAllDataForDateRef.current(selectedDateRef.current);
                }
              }
              await refreshMonthStatuses();
              break;
            }
            case 'APPOINTMENT_STATUS_UPDATED':
            case 'TIMESLOT_CREATED':
            case 'TIMESLOT_UPDATED':
            case 'TIMESLOT_DELETED':
            case 'SCHEDULE_CREATED':
            case 'SCHEDULE_UPDATED':
            case 'APPOINTMENT_STATUS_UPDATED':
            case 'APPOINTMENT_RESCHEDULED':
              if (timeSlotId) {
                if (refreshTimeSlotByIdRef.current) {
                  await refreshTimeSlotByIdRef.current(timeSlotId);
                }
              } else {
                if (fetchAllDataForDateRef.current) {
                  await fetchAllDataForDateRef.current(selectedDateRef.current);
                }
              }
              await refreshSingleDateStatus(selectedDateRef.current);
              await refreshMonthStatuses();
              break;
            default:
              break;
          }
        } catch {}
      };
      es.onerror = () => {
        try { es?.close(); } catch {}
        if (stopped) return;
        retry = Math.min(retry + 1, 5);
        const delay = Math.min(30000, 1000 * Math.pow(2, retry));
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => { stopped = true; if (es) es.close(); if (timer) clearTimeout(timer); };
  }, [status, doctorProfile?.id]);
  useEffect(() => {
    if (!overlayText) return;
    const t = setTimeout(() => setOverlayText(null), 5000);
    return () => clearTimeout(t);
  }, [overlayText]);
  useEffect(() => {
    if (error) setOverlayText(error);
  }, [error]);
  

  // 監聽月份變化，重新獲取日期狀態數據
  useEffect(() => {
    refreshMonthStatuses();
  }, [currentMonth.getFullYear(), currentMonth.getMonth(), status, doctorProfile, refreshMonthStatuses]);


  const handleApplyTemplate = async () => {
    if (!selectedRoomIdForTemplate) return;
    if (!selectedDate) {
      setError('请先选择一个日期');
      return;
    }
    // 前端互斥門：阻止在 setState 生效前的極速連點造成的二次進入
    if (templateApplyGateRef.current) return;
    templateApplyGateRef.current = true;
    setIsTemplateApplying(true);
    setIsLoading(true);
    setError(null);
    
    try {
      const selectedRoom = doctorProfile?.Room.find(room => room.id === selectedRoomIdForTemplate);
      const isToday = toYYYYMMDD(selectedDate) === toYYYYMMDD(new Date());
      const existingSchedule = schedulesForSelectedDay.find(s => s.room.id === selectedRoomIdForTemplate);
      const existingSlots = existingSchedule?.timeSlots || [];

      // 槽位过滤：
      // 1) 如果是今天，过滤掉開始時間已過的模板時段
      // 2) 过滤掉與當前日期已有時段開始/結束時間完全相同的模板時段
      let templateToAdd = DEFAULT_TEMPLATE.filter(tpl => {
        const isPastStart = isToday && isTimeSlotPast(selectedDate, tpl.startTime);
        const isDuplicate = existingSlots.some(s => s.startTime === tpl.startTime && s.endTime === tpl.endTime);
        return !isPastStart && !isDuplicate;
      });
      const skippedCount = DEFAULT_TEMPLATE.length - templateToAdd.length;

      if (isToday && existingSlots.length === 0 && templateToAdd.length === 0) {
        templateToAdd = [...DEFAULT_TEMPLATE];
      }
      
      for (const tpl of templateToAdd) {
        // 避免模板床位數超過診室容量
        const maxBedsForRoom = selectedRoom?.bedCount ?? tpl.bedCount;
        const tplBedCount = Math.min(tpl.bedCount, maxBedsForRoom);
        const response = await fetchWithTimeout('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: toYYYYMMDD(selectedDate),
            roomId: selectedRoomIdForTemplate,
            startTime: tpl.startTime,
            endTime: tpl.endTime,
            bedCount: tplBedCount,
            type: tpl.type
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Template time slot creation failed');
        }

        const newTimeSlot = await response.json();

        setSchedulesForSelectedDay(prev => {
          const existingScheduleIndex = prev.findIndex(s => s.room.id === selectedRoomIdForTemplate);
          
          if (existingScheduleIndex !== -1) {
            const updated = [...prev];
            updated[existingScheduleIndex] = {
              ...updated[existingScheduleIndex],
              timeSlots: (
                [
                  ...updated[existingScheduleIndex].timeSlots,
                  {
                    id: newTimeSlot.id,
                    startTime: newTimeSlot.startTime,
                    endTime: newTimeSlot.endTime,
                    bedCount: newTimeSlot.bedCount,
                    availableBeds: newTimeSlot.availableBeds,
                    type: newTimeSlot.type,
                    isActive: newTimeSlot.isActive,
                    appointments: []
                  }
                ]
              ).sort((a, b) => a.startTime.localeCompare(b.startTime))
            };
            return updated;
          } else {
            const room = doctorProfile?.Room.find(r => r.id === selectedRoomIdForTemplate);
            if (room) {
              return [
                ...prev,
                {
                  id: newTimeSlot.scheduleId,
                  date: toYYYYMMDD(selectedDate),
                  room,
                  timeSlots: [
                    {
                      id: newTimeSlot.id,
                      startTime: newTimeSlot.startTime,
                      endTime: newTimeSlot.endTime,
                      bedCount: newTimeSlot.bedCount,
                      availableBeds: newTimeSlot.availableBeds,
                      type: newTimeSlot.type,
                      isActive: newTimeSlot.isActive,
                      appointments: []
                    }
                  ]
                }
              ];
            }
            return prev;
          }
        });
      }
      
      setSuccess(skippedCount > 0 
        ? `模板已应用，已跳过 ${skippedCount} 個过期或重复时段`
        : '模板已应用');
      
      // 更新日历状态（乐观更新）
      setDateStatuses(prevStatuses => {
        const dateStr = toYYYYMMDD(selectedDate);
        const existingStatusIndex = prevStatuses.findIndex(s => s.date === dateStr);
        let addedBeds = 0;
        
        // 计算新增床位
        for (const tpl of templateToAdd) {
            const maxBedsForRoom = selectedRoom?.bedCount ?? tpl.bedCount;
            addedBeds += Math.min(tpl.bedCount, maxBedsForRoom);
        }

        if (addedBeds === 0) return prevStatuses;

        const newStatus: DateStatus = existingStatusIndex !== -1 
          ? { ...prevStatuses[existingStatusIndex] } 
          : { 
              date: dateStr, 
              hasSchedule: false, 
              hasAppointments: false, 
              bookedBeds: 0, 
              totalBeds: 0, 
              isPast: isPastDate(selectedDate) 
            };
        
        newStatus.hasSchedule = true;
        newStatus.totalBeds += addedBeds;
        
        // 如果是今天或未来，且添加了新时段，则肯定不是所有时段都已过去
        if (!isPastDate(selectedDate)) {
             newStatus.isPast = false;
        }

        if (existingStatusIndex !== -1) {
          const newStatuses = [...prevStatuses];
          newStatuses[existingStatusIndex] = newStatus;
          return newStatuses;
        } else {
          return [...prevStatuses, newStatus];
        }
      });

      // 確保切換到對應的診室 Tab，否則如果當前 Tab 為空或不同，新排班不會顯示
      if (selectedRoomIdForTemplate) {
        setActiveRoomTab(selectedRoomIdForTemplate);
      }
      
      setIsTemplateModalOpen(false);
    } catch (err) {
      setError('Error applying template.');
    } finally {
      setIsLoading(false);
      setIsTemplateApplying(false);
      templateApplyGateRef.current = false;
    }
  };

  const closeTemplateModal = () => {
    if (isTemplateApplying) return;
    setIsTemplateModalOpen(false);
  };

  const handleSaveTimeSlot = async (scheduleId: string, slotIndex: number) => {
    const key = `${scheduleId}-${slotIndex}`;
    const editedSlot = editingSlots[key];
    if (!editedSlot) return;

    const schedule = schedulesForSelectedDay.find(s => s.id === scheduleId);
    if (!schedule) return;

    // 前端校驗：結束時間必須大於開始時間，床位數必須大於 0
    const currentSlot = schedule.timeSlots[slotIndex];
    const nextStart = editedSlot?.startTime ?? currentSlot.startTime;
    const nextEnd = editedSlot?.endTime ?? currentSlot.endTime;
    const nextBedCount = editedSlot?.bedCount !== undefined ? Number(editedSlot.bedCount) : currentSlot.bedCount;

    if (!nextStart || !nextEnd) {
      setError('開始時間與結束時間不可為空');
      return;
    }
    if (nextEnd <= nextStart) {
      setError('結束時間必須大於開始時間');
      return;
    }
    if (isNaN(nextBedCount) || nextBedCount <= 0) {
      setError('床位數必須大於 0');
      return;
    }
    // 不可超過診室容量
    const roomMaxBeds = schedule.room.bedCount;
    if (nextBedCount > roomMaxBeds) {
      setError(`床位數不可超過診室床位數（最大 ${roomMaxBeds}）`);
      return;
    }

    // 使用 savingTimeSlots 以便按鈕正確顯示保存中狀態
    setSavingTimeSlots(prev => new Set([...prev, key]));
    setError(null);

    try {
      // 直接更新現有的時間段（使用新的 TimeSlot 模型字段）
      const url = `/api/schedules?timeSlotId=${currentSlot.id}`;
      const response = await fetchWithTimeout(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: nextStart,
          endTime: nextEnd,
          bedCount: nextBedCount,
          type: editedSlot?.type ?? currentSlot.type,
          isActive: currentSlot.isActive
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save time slot');
      }

      const updatedTimeSlot = await response.json();

      setSchedulesForSelectedDay(prev => 
        prev.map(s => 
          s.id === scheduleId 
            ? {
                ...s,
                timeSlots: s.timeSlots.map((slot, idx) => 
                  idx === slotIndex 
                    ? {
                        ...slot,
                        ...updatedTimeSlot
                      }
                    : slot
                )
              }
            : s
        )
      );

      setEditingSlots(prev => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });

      // 保存成功後清除已修改標記，恢復正常背景
      setModifiedTimeSlots(prev => {
        const updated = new Set(prev);
        updated.delete(key);
        return updated;
      });

      setSuccess('時段已保存');
      setTimeout(() => setSuccess(null), 3000);
      
      // 刷新該日期的狀態，確保角標顯示最新的床位數
      await refreshSingleDateStatus(selectedDate);
    } catch (err) {
      setError(`Error saving time slot: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSavingTimeSlots(prev => {
        const updated = new Set(prev);
        updated.delete(key);
        return updated;
      });
    }
  };

  const handleAddAppointment = (schedule: Schedule, slotIndex: number) => {
    setSelectedScheduleForBooking(schedule);
    setSelectedSlotIndexForBooking(slotIndex);
    setIsBookingModalOpen(true);
    setPatientSearchQuery('');
    setSearchedPatients([]);
    setSelectedPatient(null);
  };

  const searchPatients = async (query: string) => {
    const isCJK = /[\u3400-\u9FFF]/.test(query);
    if (!isCJK && query.length < 2) {
      setSearchedPatients([]);
      return;
    }
    try {
      const response = await fetchWithTimeout(`/api/patients/search?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const patients = await response.json();
        setSearchedPatients(patients);
      }
    } catch (error) {
      console.error('Failed to search patients:', error);
    }
  };

  const handleAddTimeSlot = async () => {
    if (!selectedRoomIdForTemplate || !newTimeSlotData.startTime || !newTimeSlotData.endTime || !newTimeSlotData.bedCount) {
      setError('請填寫所有必需字段');
      return;
    }
    if (!selectedDate) {
      setError('请先选择一个日期');
      return;
    }

    // 基本時間校驗：結束時間不可早於或等於開始時間
    if (newTimeSlotData.endTime <= newTimeSlotData.startTime) {
      setError('結束時間不能早於或等於開始時間');
      return;
    }

    // 防重校驗：同一診室同一天，開始或結束時間不可與現有時段相同
    const sc = schedulesForSelectedDay.find(s => s.room.id === selectedRoomIdForTemplate);
    const startDup = !!(sc && sc.timeSlots.some(ts => ts.startTime === newTimeSlotData.startTime));
    const endDup = !!(sc && sc.timeSlots.some(ts => ts.endTime === newTimeSlotData.endTime));
    if (startDup) {
      setOverlayText('该排班已有相同开始时间的时段');
      return;
    }
    if (endDup) {
      setOverlayText('该排班已有相同结束时间的时段');
      return;
    }

    let addedOk = false;
    try {
      setIsLoading(true);
      setIsAddingTimeSlot(true);
      setError(null);

      // 自動推斷時段類型：12:00 之前為上午，之後為下午
      const inferredType: 'MORNING' | 'AFTERNOON' = (newTimeSlotData.startTime < '12:00') ? 'MORNING' : 'AFTERNOON';

      const response = await fetchWithTimeout('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: toYYYYMMDD(selectedDate),
          roomId: selectedRoomIdForTemplate,
          startTime: newTimeSlotData.startTime,
          endTime: newTimeSlotData.endTime,
          // 保障不超過診室床位數
          bedCount: (() => {
            const selectedRoom = doctorProfile?.Room.find(r => r.id === selectedRoomIdForTemplate);
            const maxBeds = selectedRoom?.bedCount ?? Number.MAX_SAFE_INTEGER;
            const parsed = parseInt(newTimeSlotData.bedCount);
            return Math.min(parsed, maxBeds);
          })()
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        const msg = errorData.error || '新增時段失敗';
        if (msg.includes('相同开始时间') || msg.includes('相同結束時間') || msg.includes('相同结束时间') || msg.includes('已存在该时间段')) {
          setOverlayText(msg);
          return;
        }
        throw new Error(msg);
      }

      const newTimeSlot = await response.json();

      // 更新本地狀態
      setSchedulesForSelectedDay(prev => {
        const existingScheduleIndex = prev.findIndex(s => s.room.id === selectedRoomIdForTemplate);
        
        if (existingScheduleIndex !== -1) {
          // 如果該診室已有排班，添加新時段
          const updated = [...prev];
          updated[existingScheduleIndex] = {
            ...updated[existingScheduleIndex],
            timeSlots: [
              ...updated[existingScheduleIndex].timeSlots,
              {
                id: newTimeSlot.id,
                startTime: newTimeSlot.startTime,
                endTime: newTimeSlot.endTime,
                bedCount: newTimeSlot.bedCount,
                availableBeds: newTimeSlot.availableBeds,
                type: newTimeSlot.type,
                isActive: newTimeSlot.isActive,
                appointments: []
              }
            ]
          };
          return updated;
        } else {
          // 如果該診室沒有排班，創建新的排班記錄
          const selectedRoom = doctorProfile?.Room.find(r => r.id === selectedRoomIdForTemplate);
          if (selectedRoom) {
            return [...prev, {
              id: newTimeSlot.scheduleId,
              date: toYYYYMMDD(selectedDate),
              room: selectedRoom,
              timeSlots: [{
                id: newTimeSlot.id,
                startTime: newTimeSlot.startTime,
                endTime: newTimeSlot.endTime,
                bedCount: newTimeSlot.bedCount,
                availableBeds: newTimeSlot.availableBeds,
                type: newTimeSlot.type,
                isActive: newTimeSlot.isActive,
                appointments: []
              }]
            }];
          }
          return prev;
        }
      });

      // 關閉模態框並重置表單
      addedOk = true;
      setIsAddTimeSlotModalOpen(false);
      setNewTimeSlotData({ startTime: '', endTime: '', bedCount: '' });
      
      setSuccess('時段新增成功');
      setTimeout(() => setSuccess(null), 3000);
      
      // 確保切換到對應的診室 Tab，否則如果當前 Tab 為空或不同，新排班不會顯示
      if (selectedRoomIdForTemplate) {
        setActiveRoomTab(selectedRoomIdForTemplate);
      }

      await refreshSingleDateStatus(selectedDate);
      await refreshMonthStatuses();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '新增時段失敗';
      if (msg.includes('相同开始时间') || msg.includes('相同結束時間') || msg.includes('相同结束时间') || msg.includes('已存在该时间段')) {
        setOverlayText(msg);
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
      setIsAddingTimeSlot(false);
      // 保險措施：如成功，確保模態框已關閉且表單重置
      if (addedOk) {
        setIsAddTimeSlotModalOpen(false);
        setNewTimeSlotData({ startTime: '', endTime: '', bedCount: '' });
      }
    }
  };

  const closeAddTimeSlotModal = () => {
    if (isAddingTimeSlot) return;
    setIsAddTimeSlotModalOpen(false);
    setNewTimeSlotData({ startTime: '', endTime: '', bedCount: '' });
  };

  const handleBookingSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!selectedPatient || !selectedScheduleForBooking || selectedSlotIndexForBooking === null || !doctorProfile) {
      setError('Please select patient and time slot');
      return;
    }
    if ((selectedPatient.credibilityScore ?? 0) <= 0) {
      setError('該病人積分小於或等於 0，無法預約');
      return;
    }
    
    try {
      setIsBookingSubmitting(true);
      const selectedTimeSlot = selectedScheduleForBooking.timeSlots[selectedSlotIndexForBooking];
      
      const response = await fetchWithTimeout('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedPatient.userId,
          patientId: selectedPatient.id,
          doctorId: doctorProfile.id,
          timeSlotId: selectedTimeSlot.id,
          roomId: selectedScheduleForBooking.room.id
        })
      });

      if (!response.ok) {
        let errorMessage = `Booking failed (HTTP ${response.status})`;
        try {
          const bodyText = await response.text();
          if (bodyText) {
            try {
              const errorData = JSON.parse(bodyText);
              errorMessage = (errorData && errorData.error) ? errorData.error : bodyText;
            } catch {
              // 非JSON，直接使用文本
              errorMessage = bodyText;
            }
          } else {
            // 無響應體時根據常見狀態給出更明確提示
            if (response.status === 401 || response.status === 403) {
              errorMessage = '未授權：請登入或檢查會話設定';
            }
          }
        } catch (readErr) {
          // 網絡錯誤或讀取失敗
          errorMessage = '網絡錯誤或服務不可用';
        }
        throw new Error(errorMessage);
      }
      // 使用後端返回的新預約ID與狀態，避免臨時ID導致後續操作失效
      const createdAppointment = await response.json();
      setSchedulesForSelectedDay(
        prev => 
          prev.map(schedule => {
            if (schedule.id === selectedScheduleForBooking.id) {
              const updatedTimeSlots = [...schedule.timeSlots];
              updatedTimeSlots[selectedSlotIndexForBooking] = {
                ...updatedTimeSlots[selectedSlotIndexForBooking],
                availableBeds: updatedTimeSlots[selectedSlotIndexForBooking].availableBeds - 1,
                  appointments: [
                  ...updatedTimeSlots[selectedSlotIndexForBooking].appointments,
                  {
                    id: createdAppointment?.id ?? `temp-${Date.now()}`,
                    patient: { 
                      user: { 
                        name: selectedPatient.name,
                        gender: selectedPatient.gender ?? undefined,
                        dateOfBirth: selectedPatient.dateOfBirth ?? undefined
                      },
                      credibilityScore: selectedPatient.credibilityScore
                    },
                    user: { name: doctorProfile?.name || session?.user?.name || '醫生', role: 'DOCTOR' },
                    status: createdAppointment?.status ?? 'PENDING',
                    time: selectedTimeSlot.startTime,
                    reason: createdAppointment?.reason ?? '醫生預約',
                    history: [{
                      operatedAt: new Date().toISOString(),
                      operatorName: doctorProfile?.name || session?.user?.name || session?.user?.username || '醫生'
                    }]
                  }
                ]
              };
              return { ...schedule, timeSlots: updatedTimeSlots };
            }
            return schedule;
          })
      );

      setIsBookingModalOpen(false);
      setSuccess(`Successfully added appointment for ${selectedPatient.name}`);
      setTimeout(() => setSuccess(null), 3000);
      await refreshSingleDateStatus(selectedDate);
      await refreshMonthStatuses();
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    let friendly = msg || 'Failed to add appointment';
    if (msg.includes('fully booked') || msg.includes('This time slot is fully booked')) {
      friendly = '該時段已被搶完，請選擇其他時段';
    } else if (msg.includes('已经过期') || msg.includes('expired')) {
      friendly = '預約時間已過期';
    } else if (msg.includes('積分') || msg.includes('credibility')) {
      friendly = '病人積分不足，無法預約';
    } else if (msg.includes('不能重复预约') || msg.includes('duplicate') || msg.includes('该病人在此时段已有预约')) {
      friendly = '該病人在此時段已有預約';
    }
    const isDuplicate = friendly === '該病人在此時段已有預約';
    if (!isDuplicate) {
      setError(friendly);
    }
      try {
        const res = await fetchWithTimeout('/api/schedules', { cache: 'no-store' });
        if (res.ok) {
          const nextData: ScheduleApiResponse[] = await res.json();
          const formatted = nextData.map(s => ({ ...s, roomName: s.room.name }));
          setSchedulesForSelectedDay(prev => {
            const { merged } = mergeSchedulesGranular(prev, formatted);
            return merged;
          });
        }
    } catch {}
    setOverlayText(friendly);
    if (!isDuplicate) {
      setErrorDialogText(friendly);
      setShowErrorDialog(true);
    }
  } finally {
    setIsBookingSubmitting(false);
  }
  };

  // 開啟取消預約模態框
  const openCancelDialog = (appointment: Appointment, schedule: Schedule, slotIndex: number) => {
    setSelectedAppointmentForCancel({
      appointmentId: appointment.id,
      scheduleId: schedule.id,
      slotIndex,
      patientName: appointment.patient.user.name,
      date: schedule.date,
      time: appointment.time,
      roomName: schedule.room.name,
      credibilityScore: appointment.patient.credibilityScore ?? null,
    });
    setShowCancelDialog(true);
  };

  const closeCancelDialog = () => {
    if (cancelLoading) return;
    setShowCancelDialog(false);
    setSelectedAppointmentForCancel(null);
  };

  const confirmCancelAppointment = async () => {
    if (!selectedAppointmentForCancel) return;
    setCancelLoading(true);
    try {
      const response = await fetchWithTimeout(`/api/appointments/${selectedAppointmentForCancel.appointmentId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '取消预约失败');
      }

      setSchedulesForSelectedDay(
        prev => 
          prev.map(schedule => {
            if (schedule.id === selectedAppointmentForCancel.scheduleId) {
              const updatedTimeSlots = [...schedule.timeSlots];
              const idx = selectedAppointmentForCancel.slotIndex;
              updatedTimeSlots[idx] = {
                ...updatedTimeSlots[idx],
                availableBeds: updatedTimeSlots[idx].availableBeds + 1,
                appointments: updatedTimeSlots[idx].appointments.filter(
                  appointment => appointment.id !== selectedAppointmentForCancel.appointmentId
                )
              };
              return { ...schedule, timeSlots: updatedTimeSlots };
            }
            return schedule;
          })
      );

      setShowCancelDialog(false);
      setSelectedAppointmentForCancel(null);
      setSuccess(`已成功取消 ${selectedAppointmentForCancel.patientName} 的预约`);
      setTimeout(() => setSuccess(null), 3000);
      await refreshSingleDateStatus(selectedDate);
      await refreshMonthStatuses();
    } catch (error) {
      setError(error instanceof Error ? error.message : '取消預約失敗');
    } finally {
      setCancelLoading(false);
    }
  };

  // 爽約確認對話框狀態與操作
  const [showNoShowDialog, setShowNoShowDialog] = useState(false);
  const [selectedAppointmentForNoShow, setSelectedAppointmentForNoShow] = useState<{
    appointmentId: string;
    scheduleId: string;
    slotIndex: number;
    patientName: string;
    date: string;
    time: string;
    roomName: string;
    credibilityScore?: number;
  } | null>(null);
  const [noShowLoading, setNoShowLoading] = useState(false);

  // 病人詳細信息模態框狀態
  const [isPatientDetailModalOpen, setIsPatientDetailModalOpen] = useState(false);
  const [patientDetailData, setPatientDetailData] = useState<any>(null);
  const [patientHistoryAppointments, setPatientHistoryAppointments] = useState<any[]>([]);
  const [patientDetailInitialTab, setPatientDetailInitialTab] = useState<'overview' | 'treatment' | 'history'>('treatment');
  
  // Pagination State for Patient Detail Modal
  const [patientDetailTotalCount, setPatientDetailTotalCount] = useState(0);
  const [patientDetailCurrentPage, setPatientDetailCurrentPage] = useState(1);
  const [patientDetailLoading, setPatientDetailLoading] = useState(false);
  const [currentPatientId, setCurrentPatientId] = useState<string | null>(null);
  const [currentPatientTab, setCurrentPatientTab] = useState<'overview' | 'treatment' | 'history'>('treatment');

  // 病情錄入模態框狀態
  const [isSymptomModalOpen, setIsSymptomModalOpen] = useState(false);
  const [selectedAppointmentForSymptom, setSelectedAppointmentForSymptom] = useState<Appointment | null>(null);

  const fetchPatientAppointments = async (patientId: string, page: number, tab: string) => {
    if (!patientId) return;
    setPatientDetailLoading(true);
    try {
      const effectiveTab = tab === 'overview' ? 'treatment' : tab;
      const statusParam = effectiveTab === 'treatment' ? '&status=COMPLETED' : '';
      
      const res = await fetchWithTimeout(`/api/appointments?patientId=${patientId}&page=${page}&limit=5${statusParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data.pagination) {
          setPatientHistoryAppointments(data.data);
          setPatientDetailTotalCount(data.pagination.total);
          setPatientDetailCurrentPage(data.pagination.page);
        } else {
          // Fallback
          setPatientHistoryAppointments(Array.isArray(data) ? data : []);
          setPatientDetailTotalCount(Array.isArray(data) ? data.length : 0);
        }
      }
    } catch (e) {
      console.error("Failed to fetch patient appointments", e);
    } finally {
      setPatientDetailLoading(false);
    }
  };

  const openPatientDetailModal = async (patientSource: any, tab: 'overview' | 'treatment' | 'history' = 'treatment') => {
    if (!patientSource || !patientSource.user) return;
    
    // 转换数据结构以匹配 PatientDetailModal 的要求
    const mappedPatient = {
      id: patientSource.id,
      name: patientSource.user.name || '未知',
      gender: patientSource.user.gender,
      age: calcAgeFromBirthDate(patientSource.user.dateOfBirth),
      phone: patientSource.user.phone,
      credibilityScore: patientSource.credibilityScore ?? 0,
      // 以下字段在当前上下文中不可用，设为默认值
      visitCount: 0,
      noShowCount: 0,
      totalAppointments: 0
    };
    
    setPatientDetailData(mappedPatient);
    setPatientHistoryAppointments([]);
    setPatientDetailInitialTab(tab);
    
    // Set pagination state
    setCurrentPatientId(patientSource.id);
    setCurrentPatientTab(tab);
    setPatientDetailCurrentPage(1);
    
    setIsPatientDetailModalOpen(true);

    // 1. Fetch Patient Details (for stats)
    try {
      console.log(`Fetching details for patient: ${patientSource.id}`);
      const res = await fetchWithTimeout(`/api/patients/${patientSource.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.patient) {
          setPatientDetailData(data.patient);
        }
      }
    } catch (e) {
      console.error("Failed to fetch patient details", e);
    }

    // 2. Fetch Appointments (Paginated)
    await fetchPatientAppointments(patientSource.id, 1, tab);
  };

  const openSymptomModal = (appointment: Appointment) => {
    setSelectedAppointmentForSymptom(appointment);
    setIsSymptomModalOpen(true);
  };

  const handleSaveSymptom = async (appointmentId: string, symptoms: string, treatmentPlan: string) => {
    try {
      const response = await fetchWithTimeout(`/api/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptoms, treatmentPlan })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '保存失败');
      }

      // 更新本地狀態
      setSchedulesForSelectedDay(prev => 
        prev.map(schedule => ({
          ...schedule,
          timeSlots: schedule.timeSlots.map(slot => ({
            ...slot,
            appointments: slot.appointments.map(appt => 
              appt.id === appointmentId 
                ? { ...appt, symptoms, treatmentPlan }
                : appt
            )
          }))
        }))
      );
      
      setSuccess('病情与治疗方案已保存');
      setTimeout(() => setSuccess(null), 3000);
      setIsSymptomModalOpen(false);
    } catch (error) {
      console.error('Failed to save symptoms:', error);
      setError('保存失败，请重试');
    }
  };

  const openNoShowDialog = (appointment: Appointment, schedule: Schedule, slotIndex: number) => {
    setSelectedAppointmentForNoShow({
      appointmentId: appointment.id,
      scheduleId: schedule.id,
      slotIndex,
      patientName: appointment.patient.user.name,
      date: schedule.date,
      time: appointment.time,
      roomName: schedule.room.name,
      credibilityScore: appointment.patient.credibilityScore,
    });
    setShowNoShowDialog(true);
  };

  const closeNoShowDialog = () => {
    if (noShowLoading) return;
    setShowNoShowDialog(false);
    setSelectedAppointmentForNoShow(null);
  };

  const handleMarkNoShow = async (appointmentId: string, scheduleId: string, slotIndex: number, patientName: string) => {
    try {
      const slotBefore = schedulesForSelectedDay.find(s => s.id === scheduleId)?.timeSlots[slotIndex];
      const apptBefore = slotBefore?.appointments.find(a => a.id === appointmentId);
      const wasCompletedBefore = apptBefore?.status === 'COMPLETED';
      const response = await fetchWithTimeout('/api/appointments/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId, status: 'NO_SHOW' })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '标记爽约失败');
      }

      setSchedulesForSelectedDay(
        prev => 
          prev.map(schedule => {
            if (schedule.id === scheduleId) {
              const updatedTimeSlots = [...schedule.timeSlots];
              updatedTimeSlots[slotIndex] = {
                ...updatedTimeSlots[slotIndex],
                appointments: updatedTimeSlots[slotIndex].appointments.map(
                  appointment => {
                    if (appointment.id !== appointmentId) return appointment;
                    const deducted = wasCompletedBefore ? 6 : 0;
                    return {
                      ...appointment,
                      status: 'NO_SHOW',
                      patient: {
                        ...appointment.patient,
                        credibilityScore: ((appointment.patient.credibilityScore ?? 0) - deducted)
                      }
                    };
                  }
                )
              };
              return { ...schedule, timeSlots: updatedTimeSlots };
            }
            return schedule;
          })
      );

      setSelectedAppointmentForNoShow(prev => prev ? { 
        ...prev, 
        credibilityScore: ((prev.credibilityScore ?? 0) - (wasCompletedBefore ? 6 : 0))
      } : prev);

      setSuccess(wasCompletedBefore ? `已标记 ${patientName} 为爽约并扣除6分` : `已标记 ${patientName} 为爽约`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : '标记爽约失败');
    }
  };

  const toggleCollapse = (scheduleId: string, slotIndex: number) => {
    const key = `${scheduleId}-${slotIndex}`;
    setCollapsedSlots(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleDeleteTimeSlot = async (scheduleId: string, timeSlotId: string) => {
    if (!confirm('Are you sure you want to delete this time slot?')) {
      return;
    }

    if (!selectedDate) {
      setError('Internal Error: No date selected');
      return;
    }

    const key = `${scheduleId}-${timeSlotId}`;
    setDeletingSlots(prev => new Set([...prev, key]));
    setError(null);

    try {
      const deleteUrl = `/api/schedules?timeSlotId=${timeSlotId}`;
      const response = await fetchWithTimeout(deleteUrl, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete time slot');
      }

      setSchedulesForSelectedDay(prev => {
        const next = prev.map(schedule => {
          if (schedule.id === scheduleId) {
            return {
              ...schedule,
              timeSlots: schedule.timeSlots.filter(slot => slot.id !== timeSlotId)
            };
          }
          return schedule;
        });
        const dedupedNext = dedupeSchedulesByRoom(next);
        const dateStr = toYYYYMMDD(selectedDate);
        const totals = dedupedNext.reduce((acc: { bookedBeds: number; totalBeds: number }, sch) => {
          for (const ts of sch.timeSlots || []) {
            acc.totalBeds += Number(ts.bedCount || 0);
            const used = Number(ts.bedCount || 0) - Number(ts.availableBeds || 0);
            acc.bookedBeds += used > 0 ? used : 0;
          }
          return acc;
        }, { bookedBeds: 0, totalBeds: 0 });
        const updatedStatus = {
          date: dateStr,
          hasSchedule: dedupedNext.some(s => (s.timeSlots || []).length > 0),
          hasAppointments: totals.bookedBeds > 0,
          bookedBeds: totals.bookedBeds,
          totalBeds: totals.totalBeds,
          isPast: isPastDate(selectedDate),
        };
        setDateStatuses(prevStatuses => {
          const idx = prevStatuses.findIndex(st => st.date === dateStr);
          if (idx >= 0) {
            const copy = [...prevStatuses];
            copy[idx] = updatedStatus;
            return copy;
          }
          return [...prevStatuses, updatedStatus];
        });
        return dedupedNext;
      });
    } catch (err) {
      setError(`Error deleting time slot: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDeletingSlots(prev => {
        const updated = new Set(prev);
        updated.delete(key);
        return updated;
      });
    }
  };

  const uniqueRooms = useMemo(() => {
    if (doctorProfile?.Room && doctorProfile.Room.length > 0) {
      return doctorProfile.Room;
    }
    const roomMap = new Map();
    schedulesForSelectedDay.forEach(schedule => {
      if (!roomMap.has(schedule.room.id)) {
        roomMap.set(schedule.room.id, schedule.room);
      }
    });
    return Array.from(roomMap.values());
  }, [doctorProfile, schedulesForSelectedDay]);

  const activeSchedules = useMemo(() => {
    return schedulesForSelectedDay.filter(schedule => schedule.room.id === activeRoomTab);
  }, [schedulesForSelectedDay, activeRoomTab]);

  // 在會話尚未就緒時顯示載入狀態，避免誤報「無法載入」
  if (status === 'loading') return (
    <div className="mobile-loading" style={{ height: '100vh' }}>
      <div className="mobile-loading-spinner"></div>
    </div>
  );

  return (
    <div className="page-container space-y-2">
      {/* 全局加載與錯誤處理懸浮層 */}
      {(isLoading || isNetworkError) && (
        <div className="mobile-global-loading-overlay">
          {isLoading ? (
            <div className="mobile-loading-spinner"></div>
          ) : (
            <div className="bg-white p-6 rounded-xl shadow-lg flex flex-col items-center max-w-[80%] mx-auto animate-in fade-in zoom-in duration-200">
               <div className="text-red-500 mb-3 text-4xl">⚠️</div>
               <p className="text-gray-800 font-bold mb-2 text-center">{error || '网络请求失败'}</p>
               <p className="text-gray-500 text-sm mb-5 text-center">请检查网络连接后重试</p>
               <button 
                 onClick={() => fetchAllDataForDate(selectedDate)}
                 className="mobile-btn mobile-btn-primary w-full"
               >
                 重试
               </button>
            </div>
          )}
        </div>
      )}

      {overlayText && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[2000]">
          <div className="bg-black/60 text-white text-sm px-4 py-2 rounded">{overlayText}</div>
        </div>
      )}
      
      <div className="mobile-card">
        <div className="w-full flex justify-between items-center mb-2">
          {doctorProfile?.name ? (
            <h1 className="mobile-header" style={{ marginBottom: 0 }}>{doctorProfile.name}</h1>
          ) : null}
        </div>
        <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'center', width: '100%' }}>
          <EnhancedDatePicker
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            dateStatuses={dateStatuses}
            isLoading={isLoading}
            suppressSpinner={true}
            onMonthChange={handleCalendarMonthChange}
          />
        </div>

        {/* 移除非中央透明提示（success/error toast） */}
        
        <div className="w-full grid grid-cols-2 gap-2">
          <button
            onClick={() => setIsTemplateModalOpen(true)}
            className="mobile-btn mobile-btn-primary w-full flex items-center justify-center space-x-2"
            title="使用模板填充"
            disabled={isLoading || isTemplateApplying}
          >
            {isTemplateApplying ? (
              <span className="mobile-btn-spinner" aria-hidden="true" />
            ) : (
              <FaPlusCircle className="w-4 h-4" />
            )}
            <span>{isTemplateApplying ? '处理中...' : '使用模板填充'}</span>
          </button>
          <button
            onClick={() => setIsAddTimeSlotModalOpen(true)}
            className="mobile-btn mobile-btn-success w-full flex items-center justify-center space-x-2"
            title="新增自定义时段"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="mobile-btn-spinner" aria-hidden="true" />
            ) : (
              <FaPlusCircle className="w-4 h-4" />
            )}
            <span>{isLoading ? '加载中...' : '新增自定义时段'}</span>
          </button>
        </div>
      </div>

      {schedulesForSelectedDay.length === 0 ? (
        <div className="mobile-empty-state">
          <h3>今日无排班</h3>
          <p>请选择其他日期或新增排班</p>
        </div>
      ) : (
        <div className="space-y-2 w-full flex flex-col items-center">
          {/* 手機端診室選擇 - 多標籤頁顯示 */}
          {uniqueRooms.length > 0 && (
            <div className="flex w-full mb-3 bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
              {uniqueRooms.map(room => {
                const isActive = activeRoomTab === room.id;
                const hasSchedule = schedulesForSelectedDay.some(s => s.room.id === room.id);
                
                return (
                  <button
                    key={room.id}
                    onClick={() => setActiveRoomTab(room.id)}
                    disabled={isLoading}
                    className={`flex-1 py-3 text-sm font-medium transition-colors relative
                      ${isActive 
                        ? 'bg-blue-50 text-blue-600 font-semibold' 
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                      }
                    `}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="truncate max-w-[100px]">{room.name}</span>
                      {room.isPrivate && <span className="text-xs text-red-500 font-normal scale-90">(私)</span>}
                      {hasSchedule && (
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-blue-500' : 'bg-blue-300'}`}></span>
                      )}
                    </div>
                    {isActive && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"></div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {activeSchedules.map(schedule => (
            <div key={schedule.id} className="mobile-card space-y-2">
              {schedule.timeSlots && Array.isArray(schedule.timeSlots) ? schedule.timeSlots.map((slot, index) => {
                const key = `${schedule.id}-${index}`;
                const isModified = modifiedTimeSlots.has(key);
                const isSaving = savingTimeSlots.has(key);
                const isDeleting = deletingSlots.has(`${schedule.id}-${slot.id}`);
                const isExpanded = expandedTimeSlots.has(key);
                const editedStart = getSlotValue(schedule.id, index, 'startTime', slot.startTime) as string;
                const editedEnd = getSlotValue(schedule.id, index, 'endTime', slot.endTime) as string;
                const editedBedCount = Number(getSlotValue(schedule.id, index, 'bedCount', slot.bedCount));
                const isValidEdit = !!editedStart && !!editedEnd && (editedEnd > editedStart) && editedBedCount > 0 && editedBedCount <= schedule.room.bedCount;
                const isPast = isTimeSlotPast(selectedDate, slot.startTime);
                const hasAppointments = (slot.appointments && slot.appointments.length > 0);

                return (
                  <div
                    key={index}
                    className={`mobile-time-slot-single-line ${
                      isPast
                        ? (hasAppointments ? 'mobile-time-slot-past-with-appointments' : 'mobile-time-slot-past')
                        : (hasAppointments ? 'mobile-time-slot-with-appointments' : 'mobile-time-slot-no-appointments')
                    } ${!isPast && isModified ? 'mobile-time-slot-modified' : ''} ${expandedActionRows.has(key) ? 'mobile-time-slot-selected' : ''}`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement | null;
                      if (!target) return;
                      if (
                        target.closest('input') ||
                        target.closest('button') ||
                        target.closest('select') ||
                        target.closest('.mobile-icon-btn-colored') ||
                        target.closest('.mobile-time-input-inline') ||
                        target.closest('.mobile-total-input-inline')
                      ) {
                        return;
                      }
                      const next = new Set(expandedActionRows);
                      const willExpand = !next.has(key);
                      if (next.has(key)) next.delete(key); else next.add(key);
                      setExpandedActionRows(next);
                      // 同步患者列表展開狀態：點擊行即展開（有預約時）
                      const nextExpanded = new Set(expandedTimeSlots);
                      if (willExpand) {
                        if ((slot.appointments || []).length > 0) nextExpanded.add(key);
                      } else {
                        nextExpanded.delete(key);
                      }
                      setExpandedTimeSlots(nextExpanded);
                    }}
                  >
                    {/* 第一行：時間點信息 */}
                    <div className="mobile-time-slot-info-row mobile-time-slot-info-row-grid">
                      {/* 開始時間輸入 */}
                      <input
                        type="time"
                        value={getSlotValue(schedule.id, index, 'startTime', slot.startTime)}
                        onChange={(e) => {
                          updateSlotEdit(schedule.id, index, 'startTime', e.target.value);
                          setModifiedTimeSlots(prev => new Set(prev).add(key));
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="mobile-time-input-inline mobile-time-input-fluid"
                        disabled={isPast}
                        title={
                          isPast
                            ? '時間已過，不可編輯'
                            : (hasAppointments ? '已有预约，修改需谨慎' : '開始時間')
                        }
                      />
                      
                      {/* 結束時間輸入 */}
                      <input
                        type="time"
                        value={getSlotValue(schedule.id, index, 'endTime', slot.endTime)}
                        onChange={(e) => {
                          updateSlotEdit(schedule.id, index, 'endTime', e.target.value);
                          setModifiedTimeSlots(prev => new Set(prev).add(key));
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="mobile-time-input-inline mobile-time-input-fluid"
                        disabled={isPast}
                        title={
                          isPast
                            ? '時間已過，不可編輯'
                            : (hasAppointments ? '已有预约，修改需谨慎' : '結束時間')
                        }
                      />
                      
                      {/* 床位輸入 */}
                      <input
                        type="number"
                        min="1"
                        max={schedule.room.bedCount}
                        value={getSlotValue(schedule.id, index, 'bedCount', slot.bedCount)}
                        onChange={(e) => {
                          const maxBeds = schedule.room.bedCount;
                          const raw = e.target.value;
                          const n = parseInt(raw);
                          const clamped = isNaN(n) ? 1 : Math.max(1, Math.min(n, maxBeds));
                          updateSlotEdit(schedule.id, index, 'bedCount', clamped);
                          setModifiedTimeSlots(prev => new Set(prev).add(key));
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="mobile-total-input-inline mobile-total-input-fluid"
                        placeholder="床位数"
                        disabled={isPast}
                        title={
                          isPast
                            ? '时间已过，不可编辑'
                            : (hasAppointments ? '已有预约，修改需谨慎' : `可预约人数（最大 ${schedule.room.bedCount}）`)
                        }
                      />

                      {/* 預約狀態信息 */}
                      <div className={`mobile-slot-info-inline mobile-slot-info-fluid ${
                        slot.availableBeds <= 0
                          ? 'mobile-density-high'
                          : (slot.availableBeds / Math.max(1, slot.bedCount) <= 0.25
                              ? 'mobile-density-high'
                              : (slot.availableBeds / Math.max(1, slot.bedCount) <= 0.5
                                  ? 'mobile-density-medium'
                                  : 'mobile-density-low'))
                      }`}>
                        <span className="font-semibold">
                          {slot.bedCount - slot.availableBeds}/{slot.bedCount}
                        </span>
                      </div>

                    </div>

                    {/* 第二行：操作按鈕（可折疊，平鋪三個按鈕）*/}
                    {expandedActionRows.has(key) && (
                    <div className="mobile-slot-actions-row">
                      {/* 新增按鈕 */}
                      <button
                        type="button"
                        onClick={() => handleAddAppointment(schedule, index)}
                        className={`mobile-icon-btn-colored ${
                          slot.availableBeds <= 0 || isPast
                            ? 'mobile-icon-btn-disabled-colored' 
                            : 'mobile-icon-btn-success'
                        }`}
                        disabled={slot.availableBeds <= 0 || isPast}
                        title={
                          isPast 
                            ? "时间已过，无法预约" 
                            : (slot.availableBeds <= 0 ? "已满额" : "新增预约")
                        }
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {/* 保存按钮 */}
                      <button
                        type="button"
                        onClick={() => handleSaveTimeSlot(schedule.id, index)}
                        disabled={isPast || hasAppointments || !isModified || isSaving || isDeleting || !isValidEdit}
                        className={`mobile-icon-btn-colored ${
                          !isPast && !hasAppointments && isModified && !isSaving && !isDeleting && isValidEdit
                            ? 'mobile-icon-btn-save-colored'
                            : 'mobile-icon-btn-disabled-colored'
                        }`}
                        title={
                          isPast
                            ? '时间已过，不可编辑'
                            : hasAppointments
                              ? '已有预约，不可编辑该时段'
                              : (isModified ? (isValidEdit ? '保存变更' : '时间或床位数不合法') : '无变更')
                        }
                      >
                        {isSaving ? (
                          <span className="mobile-btn-spinner" aria-hidden="true" />
                        ) : (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M7.707 10.293a1 1 0 10-1.414 1.414l2 2a1 1 0 001.414 0l4-4a1 1 0 00-1.414-1.414L9 11.586l-1.293-1.293z"/>
                          </svg>
                        )}
                      </button>

                      {/* 刪除按鈕 */}
                      <button
                        type="button"
                        onClick={() => handleDeleteTimeSlot(schedule.id, slot.id)}
                        disabled={isPast || hasAppointments || isSaving || isDeleting}
                        className={`mobile-icon-btn-colored mobile-icon-btn-delete-colored ${
                          (isPast || hasAppointments || isSaving || isDeleting) ? 'mobile-icon-btn-disabled-colored' : ''
                        }`}
                        title={
                          isPast
                            ? '時間已過，不可刪除'
                            : (hasAppointments ? '已有预约，不可刪除該時段' : '刪除時段')
                        }
                      >
                        {isDeleting ? (
                          <span className="mobile-btn-spinner" aria-hidden="true" />
                        ) : (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>

                    </div>
                    )}

                    {/* 已預約患者列表 - 展開時直接顯示 */}
                    {slot.appointments.length > 0 && expandedActionRows.has(key) && (
                      <div className="mobile-patient-list-inline">
                        {slot.appointments.map((appointment, apptIndex) => {
                          const operatedAtString = (appointment.history && appointment.history.length > 0)
                            ? new Date(appointment.history[0].operatedAt).toLocaleString('zh-TW', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })
                            : `${schedule.date} ${appointment.time}`;

                          const statusKey = normalizeStatus(appointment.status);
                          const statusText = (getStatusText(statusKey) || '').trim() || '待就诊';
                          const statusClassKey = statusKey.toLowerCase().replace('_', '-');

                          return (
                            <div key={apptIndex} className={`flex flex-col gap-3 p-3 border-b border-gray-100 last:border-0 ${statusKey === 'NO_SHOW' ? 'bg-red-50' : 'hover:bg-gray-50 transition-colors'}`}>
                              {/* 上部分：病人基本信息与操作按钮 */}
                              <div className="flex justify-between items-start w-full">
                                <div 
                                  className="flex flex-col gap-1.5 flex-1 min-w-0 cursor-pointer"
                                  onClick={() => openPatientDetailModal(appointment.patient, 'treatment')}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-gray-900 text-base truncate">{appointment.patient.user.name}</span>
                                    {(() => {
                                      const score = appointment.patient.credibilityScore ?? null;
                                      return (
                                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
                                          score && score >= 15 ? 'bg-green-50 text-green-700 border-green-200' :
                                          score && score >= 10 ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                          'bg-red-50 text-red-700 border-red-200'
                                        }`} title="积分">
                                          {score ?? '—'}分
                                        </span>
                                      );
                                    })()}
                                    {(() => {
                                      const { text } = getGenderInfo(appointment.patient.user.gender);
                                      const bgClass = text === '男' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-pink-50 text-pink-600 border-pink-100';
                                      return (
                                        <span className={`px-1.5 py-0.5 rounded text-xs border ${bgClass}`}>{text}</span>
                                      );
                                    })()}
                                    {(() => {
                                      const age = calcAgeFromBirthDate(appointment.patient.user.dateOfBirth);
                                      return (
                                        <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200">{age != null ? `${age}岁` : '未知'}</span>
                                      );
                                    })()}
                                  </div>
                                  
                                  {appointment.patient.user.phone && (
                                    <a 
                                      className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1 w-fit" 
                                      href={`tel:${String(appointment.patient.user.phone).replace(/\s+/g, '')}`} 
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                                      {appointment.patient.user.phone}
                                    </a>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0 ml-2 pt-0.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPatientDetailModal(appointment.patient, 'treatment');
                                    }}
                                    className="p-1.5 rounded-full text-purple-600 bg-purple-50 hover:bg-purple-100 transition-colors"
                                    title="治疗历史"
                                  >
                                    <FaHistory className="w-3.5 h-3.5" />
                                  </button>
                                  {normalizeStatus(appointment.status) !== 'NO_SHOW' && normalizeStatus(appointment.status) !== 'CANCELLED' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openSymptomModal(appointment);
                                      }}
                                      className={`p-1.5 rounded-full transition-colors ${
                                        appointment.symptoms 
                                          ? 'text-green-600 bg-green-50 hover:bg-green-100' 
                                          : 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                                      }`}
                                      title={appointment.symptoms ? "修改病情/治疗方案" : "录入病情/治疗方案"}
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                  )}
                                  {!isPast && normalizeStatus(appointment.status) === 'PENDING' && (
                                    <button
                                      onClick={() => openCancelDialog(appointment, schedule, index)}
                                      className="p-1.5 rounded-full text-red-500 bg-red-50 hover:bg-red-100 transition-colors"
                                      title="取消预约"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                      </svg>
                                    </button>
                                  )}
                                  {isPast && normalizeStatus(appointment.status) !== 'NO_SHOW' && normalizeStatus(appointment.status) !== 'CANCELLED' && (
                                    <button
                                      onClick={() => openNoShowDialog(appointment, schedule, index)}
                                      className="p-1.5 rounded-full text-orange-500 bg-orange-50 hover:bg-orange-100 transition-colors"
                                      title="标记爽约"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16z" clipRule="evenodd" />
                                        <path fillRule="evenodd" d="M7 10a3 3 0 116 0 3 3 0 01-6 0z" clipRule="evenodd" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* 下部分：详细信息平铺展示 */}
                              <div 
                                className="grid grid-cols-4 gap-2 text-xs text-gray-500 w-full bg-gray-50/50 p-2 rounded-lg cursor-pointer"
                                onClick={() => openPatientDetailModal(appointment.patient, 'treatment')}
                              >
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[10px] text-gray-400">操作时间</span>
                                  <span className="font-medium text-gray-700 truncate" title={operatedAtString}>
                                    {operatedAtString.split(' ')[1] || operatedAtString}
                                  </span>
                                </div>
                                <div className="flex flex-col gap-0.5 border-l border-gray-100 pl-2">
                                  <span className="text-[10px] text-gray-400">操作员</span>
                                  <span className="font-medium text-gray-700 truncate" title={
                                    appointment.history && appointment.history.length > 0 
                                      ? appointment.history[0].operatorName
                                      : ((appointment.reason === '医生预约')
                                          ? (doctorProfile?.name || session?.user?.name || '医生')
                                          : appointment.patient.user.name)
                                  }>
                                    {appointment.history && appointment.history.length > 0 
                                      ? appointment.history[0].operatorName
                                      : ((appointment.reason === '医生预约')
                                          ? (doctorProfile?.name || session?.user?.name || '医生')
                                          : appointment.patient.user.name)}
                                  </span>
                                </div>
                                <div className="flex flex-col gap-0.5 border-l border-gray-100 pl-2">
                                  <span className="text-[10px] text-gray-400">角色</span>
                                  <span className="font-medium text-gray-700 truncate">
                                    {(appointment.history && appointment.history.length > 0)
                                      ? ((appointment.reason === '医生预约') ? '医生' : '患者')
                                      : ((appointment.reason === '医生预约' || appointment.user.role === 'DOCTOR') ? '医生' : '患者')}
                                  </span>
                                </div>
                                <div className="flex flex-col gap-0.5 border-l border-gray-100 pl-2">
                                  <span className="text-[10px] text-gray-400">状态</span>
                                  <span className={`font-medium truncate ${
                                    statusKey === 'COMPLETED' ? 'text-green-600' :
                                    statusKey === 'NO_SHOW' ? 'text-red-600' :
                                    statusKey === 'CANCELLED' ? 'text-gray-400' :
                                    'text-blue-600'
                                  }`}>
                                    {statusText}
                                    {appointment.symptoms && <span className="text-green-600 ml-1">✓</span>}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div className="mobile-empty-state">
                  <h3>无可用时段</h3>
                  <p>目前没有安排任何时段</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isTemplateModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <div className="mobile-modal-header">
              <h2>选择诊室套用模板</h2>
            </div>
            <div className="mobile-modal-content grid grid-cols-1 sm:grid-cols-2 gap-3">
              {isLoading && !doctorProfile ? (
                <div className="text-center py-4 col-span-full">
                  <p className="text-gray-500 text-sm">加载数据中...</p>
                </div>
              ) : !doctorProfile ? (
                <div className="text-center py-4 col-span-full">
                  <div className="text-red-400 text-lg mb-2">⚠️</div>
                  <p className="text-gray-500 text-sm">无法获取诊室信息</p>
                  <p className="text-gray-400 text-xs mt-1 mb-3">可能是网络问题导致</p>
                  <button 
                    onClick={() => fetchAllDataForDate(selectedDate)}
                    className="mobile-btn mobile-btn-primary text-sm py-1 px-4 inline-block w-auto h-auto"
                    type="button"
                  >
                    重试
                  </button>
                </div>
              ) : doctorProfile.Room && doctorProfile.Room.length > 0 ? (
                <div>
                  <label htmlFor="room-template" className="block text-sm font-medium mb-2">诊室</label>
                  <select
                    id="room-template"
                    value={selectedRoomIdForTemplate}
                    onChange={(e) => setSelectedRoomIdForTemplate(e.target.value)}
                    className="mobile-input w-full"
                  >
                    {doctorProfile.Room.map(room => (
                      <option key={room.id} value={room.id}>{room.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="text-center py-4 col-span-full">
                  <div className="text-gray-400 text-lg mb-2">🏥</div>
                  <p className="text-gray-500 text-sm">医生名下没有诊室</p>
                  <p className="text-gray-400 text-xs mt-1">请联系管理员分配诊室</p>
                </div>
              )}
            </div>
            <div className="mobile-modal-footer">
              <button 
                type="button" 
                onClick={closeTemplateModal} 
                className="mobile-btn mobile-btn-secondary flex-1"
                disabled={isTemplateApplying}
              >
                取消
              </button>
              <button 
                onClick={handleApplyTemplate} 
                className={`mobile-btn flex-1 ${
                  doctorProfile?.Room && doctorProfile.Room.length > 0 
                    ? 'mobile-btn-primary' 
                    : 'mobile-btn-disabled'
                }`}
                disabled={isTemplateApplying || !doctorProfile?.Room || doctorProfile.Room.length === 0}
              >
                {isTemplateApplying ? '套用中…' : '套用'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isBookingModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal mobile-modal-compact">
            <div className="mobile-modal-header">
              <h2 className="text-xl font-bold">新增預約</h2>
            </div>
            <form id="bookingForm" onSubmit={handleBookingSubmit} className="mobile-modal-content space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">時間</label>
                <input
                  type="text"
                  value={selectedScheduleForBooking?.timeSlots[selectedSlotIndexForBooking || 0]?.startTime || ''}
                  readOnly
                  className="mobile-input w-full bg-gray-100"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">搜尋患者</label>
                <input
                  type="text"
                  value={patientSearchQuery}
                  onChange={(e) => {
                    setPatientSearchQuery(e.target.value);
                    searchPatients(e.target.value);
                  }}
                  className="mobile-input w-full"
                  placeholder="輸入患者姓名或用戶名"
                />
                
                {searchedPatients.length > 0 && (
                  <div className="mobile-search-results">
                    {searchedPatients.map((patient) => (
                      <button
                        key={patient.id}
                        type="button"
                        onClick={() => {
                          setSelectedPatient(patient);
                          setPatientSearchQuery(patient.name);
                          setSearchedPatients([]);
                        }}
                        className="mobile-search-item"
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="truncate">
                            {patient.name} ({patient.username})
                          </div>
                          <div className="flex items-center ml-2 shrink-0 space-x-1">
                            <span className={`credit-inline-badge ${getCreditColorClass(patient.credibilityScore)}`}>{typeof patient.credibilityScore === 'number' ? patient.credibilityScore : '未知'}</span>
                            {(() => { const g = getGenderInfo(patient.gender ?? undefined); return (<span className={`gender-inline-badge ${g.className}`}>{g.text}</span>); })()}
                            {(() => { const age = calcAgeFromBirthDate(patient.dateOfBirth ?? undefined); return (<span className="age-inline-badge">{age ?? '未知'}</span>); })()}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedPatient && (
                <div className="mobile-selected-patient">
                  <div className="text-sm text-gray-600">已選擇患者:</div>
                  <div className="font-medium">{selectedPatient.name} ({selectedPatient.username})</div>
                <div className="flex items-center mt-1 space-x-2">
                  <span className={`credit-inline-badge ${getCreditColorClass(selectedPatient.credibilityScore)}`}>{typeof selectedPatient.credibilityScore === 'number' ? selectedPatient.credibilityScore : '未知'}</span>
                  {(() => { const g = getGenderInfo(selectedPatient.gender ?? undefined); return (<span className={`gender-inline-badge ${g.className}`}>{g.text}</span>); })()}
                  {(() => { const age = calcAgeFromBirthDate(selectedPatient.dateOfBirth ?? undefined); return (<span className="age-inline-badge">{age ?? '未知'}</span>); })()}
                </div>
                  {((selectedPatient.credibilityScore ?? 0) <= 0) && (
                    <div className="text-xs text-red-600 mt-1">該病人積分為 0 或以下，無法預約</div>
                  )}
                </div>
              )}
            </form>
            <div className="mobile-modal-footer">
              <button
                type="button"
                onClick={() => { if (isBookingSubmitting) return; setIsBookingModalOpen(false); }}
                className="mobile-btn mobile-btn-secondary flex-1"
                disabled={isBookingSubmitting}
              >
                取消
              </button>
              <button
                type="submit"
                form="bookingForm"
                disabled={!selectedPatient || isBookingSubmitting || ((selectedPatient?.credibilityScore ?? 0) <= 0)}
                className="mobile-btn mobile-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-busy={isBookingSubmitting}
              >
                {isBookingSubmitting ? '确认中…' : '确认预约'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showErrorDialog && (
        <div className="mobile-dialog-overlay">
          <div className="mobile-dialog">
            <div className="mobile-dialog-header">
              <h3 className="mobile-dialog-title">预约失败</h3>
              <button onClick={() => { if (isBookingSubmitting) return; setShowErrorDialog(false); setErrorDialogText(null); }} className="mobile-dialog-close-btn" aria-label="关闭" disabled={isBookingSubmitting}>×</button>
            </div>
            <div className="mobile-dialog-content">
              <p className="mobile-dialog-text">{errorDialogText || '预约失败'}</p>
            </div>
            <div className="mobile-dialog-footer">
              <button onClick={() => { if (isBookingSubmitting) return; setShowErrorDialog(false); setErrorDialogText(null); }} className="mobile-btn mobile-btn-primary">知道了</button>
            </div>
          </div>
        </div>
      )}

      {showNoShowDialog && selectedAppointmentForNoShow && (
        <div className="mobile-dialog-overlay">
          <div className="mobile-dialog">
            <div className="mobile-dialog-header">
              <h3 className="mobile-dialog-title">确认标记爽约</h3>
              <button onClick={closeNoShowDialog} className="mobile-dialog-close-btn" aria-label="关闭" disabled={noShowLoading}>×</button>
            </div>
            <div className="mobile-dialog-content">
              <p className="mobile-dialog-text">将标记 {selectedAppointmentForNoShow.patientName} 爽约并扣除信用分。</p>
              <div className="mobile-dialog-details">
                <div className="mobile-dialog-detail-row">
                  <span className="mobile-dialog-detail-label">日期</span>
                  <span className="mobile-dialog-detail-value">{formatDate(selectedAppointmentForNoShow.date)}</span>
                </div>
                <div className="mobile-dialog-detail-row">
                  <span className="mobile-dialog-detail-label">时间</span>
                  <span className="mobile-dialog-detail-value">{selectedAppointmentForNoShow.time}</span>
                </div>
                <div className="mobile-dialog-detail-row">
                  <span className="mobile-dialog-detail-label">诊室</span>
                  <span className="mobile-dialog-detail-value">{selectedAppointmentForNoShow.roomName}</span>
                </div>
                <div className="mobile-dialog-detail-row">
                  <span className="mobile-dialog-detail-label">病人信用分</span>
                  <span className="mobile-dialog-detail-value">{selectedAppointmentForNoShow.credibilityScore ?? '—'}</span>
                </div>
              </div>
              <div className="mobile-dialog-actions">
                <button className="mobile-btn-secondary" onClick={closeNoShowDialog} disabled={noShowLoading}>取消</button>
                <button
                  className="mobile-dialog-confirm-btn"
                  onClick={async () => {
                    if (!selectedAppointmentForNoShow) return;
                    setNoShowLoading(true);
                    await handleMarkNoShow(
                      selectedAppointmentForNoShow.appointmentId,
                      selectedAppointmentForNoShow.scheduleId,
                      selectedAppointmentForNoShow.slotIndex,
                      selectedAppointmentForNoShow.patientName
                    );
                    setNoShowLoading(false);
                    closeNoShowDialog();
                  }}
                  disabled={noShowLoading}
                >
                  {noShowLoading ? '提交中…' : '确认标记爽约'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCancelDialog && selectedAppointmentForCancel && (
        <CancelAppointmentModal
          isOpen={showCancelDialog}
          info={{
            patientName: selectedAppointmentForCancel.patientName,
            credibilityScore: selectedAppointmentForCancel.credibilityScore ?? null,
            date: formatDate(selectedAppointmentForCancel.date),
            time: selectedAppointmentForCancel.time,
            roomName: selectedAppointmentForCancel.roomName,
          }}
          onClose={closeCancelDialog}
          onConfirm={confirmCancelAppointment}
          isProcessing={cancelLoading}
        />
      )}

      {isAddTimeSlotModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal mobile-modal-compact">
            <div className="mobile-modal-header">
              <h2 className="text-xl font-bold">新增时段</h2>
            </div>
            <div className="mobile-modal-content space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">诊室</label>
                <select
                  value={selectedRoomIdForTemplate}
                  onChange={(e) => setSelectedRoomIdForTemplate(e.target.value)}
                  className="mobile-input w-full"
                  required
                >
                  <option value="">请选择诊室</option>
                  {doctorProfile?.Room?.map(room => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium mb-2">时间</label>
                <div className="flex items-center gap-3">
                  <input
                    type="time"
                    value={newTimeSlotData.startTime}
                    onChange={(e) => setNewTimeSlotData(prev => ({ ...prev, startTime: e.target.value }))}
                    className="mobile-input flex-1"
                    required
                  />
                  <span className="text-gray-500">至</span>
                  <input
                    type="time"
                    value={newTimeSlotData.endTime}
                    onChange={(e) => setNewTimeSlotData(prev => ({ ...prev, endTime: e.target.value }))}
                    className="mobile-input flex-1"
                    required
                  />
                </div>
                {(() => {
                  const sc = schedulesForSelectedDay.find(s => s.room.id === selectedRoomIdForTemplate);
                  const dup = !!(sc && newTimeSlotData.startTime && sc.timeSlots.some(ts => ts.startTime === newTimeSlotData.startTime));
                  return dup ? (<p className="text-xs text-red-600 mt-1">开始时间与现有时段重复</p>) : null;
                })()}
                {(() => {
                  const sc = schedulesForSelectedDay.find(s => s.room.id === selectedRoomIdForTemplate);
                  const dup = !!(sc && newTimeSlotData.endTime && sc.timeSlots.some(ts => ts.endTime === newTimeSlotData.endTime));
                  return dup ? (<p className="text-xs text-red-600">结束时间与现有时段重复</p>) : null;
                })()}
              </div>
              
              
              
              <div>
                <label className="block text-sm font-medium mb-2">可预约人数</label>
                <input
                  type="number"
                  min="1"
                  max={selectedRoomIdForTemplate ? (doctorProfile?.Room.find(r => r.id === selectedRoomIdForTemplate)?.bedCount ?? 50) : 50}
                  value={newTimeSlotData.bedCount}
                  onChange={(e) => {
                    const selectedRoom = doctorProfile?.Room.find(r => r.id === selectedRoomIdForTemplate);
                    const maxBeds = selectedRoom?.bedCount ?? 50;
                    const n = parseInt(e.target.value);
                    const clamped = isNaN(n) ? '' : String(Math.max(1, Math.min(n, maxBeds)));
                    setNewTimeSlotData(prev => ({ ...prev, bedCount: clamped }));
                  }}
                  className="mobile-input w-full"
                  placeholder="请输入可预约人数（不超过诊室床位数）"
                  required
                />
              </div>
            </div>
            <div className="mobile-modal-footer">
              <button
                type="button"
                onClick={closeAddTimeSlotModal}
                className="mobile-btn mobile-btn-outline flex-1"
                disabled={isAddingTimeSlot}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddTimeSlot}
                disabled={
                  isAddingTimeSlot ||
                  !selectedRoomIdForTemplate ||
                  !newTimeSlotData.startTime ||
                  !newTimeSlotData.endTime ||
                  !newTimeSlotData.bedCount ||
                  (newTimeSlotData.endTime <= newTimeSlotData.startTime) ||
                  (() => {
                    const sc = schedulesForSelectedDay.find(s => s.room.id === selectedRoomIdForTemplate);
                    return !!(sc && newTimeSlotData.startTime && sc.timeSlots.some(ts => ts.startTime === newTimeSlotData.startTime));
                  })() ||
                  (() => {
                    const sc = schedulesForSelectedDay.find(s => s.room.id === selectedRoomIdForTemplate);
                    return !!(sc && newTimeSlotData.endTime && sc.timeSlots.some(ts => ts.endTime === newTimeSlotData.endTime));
                  })()
                }
                className="mobile-btn mobile-btn-success flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-busy={isAddingTimeSlot}
              >
                {isAddingTimeSlot ? '提交中…' : '新增时段'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isPatientDetailModalOpen && (
        <PatientDetailModal
          isOpen={isPatientDetailModalOpen}
          onClose={() => setIsPatientDetailModalOpen(false)}
          patient={patientDetailData}
          appointments={patientHistoryAppointments}
          initialTab={patientDetailInitialTab}
          totalCount={patientDetailTotalCount}
          onPageChange={(page) => fetchPatientAppointments(currentPatientId!, page, currentPatientTab)}
          onTabChange={(tab) => {
            setCurrentPatientTab(tab);
            fetchPatientAppointments(currentPatientId!, 1, tab);
          }}
          isLoading={patientDetailLoading}
        />
      )}

      {isSymptomModalOpen && (
        <AppointmentSymptomModal
          isOpen={isSymptomModalOpen}
          onClose={() => setIsSymptomModalOpen(false)}
          appointment={selectedAppointmentForSymptom}
          onSave={handleSaveSymptom}
        />
      )}

      {/* 底部功能區 - 用於調試或其他用途 */}
    </div>
  );
}
