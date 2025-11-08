'use client';

import { useState, useEffect, useCallback, FormEvent, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './mobile.css';
import './mobile-overrides.css';
import '../appointments/mobile.css';
import { getStatusText } from '../../../utils/statusText';
import { FaTrash, FaSave, FaUserPlus, FaPlusCircle } from 'react-icons/fa';
import EnhancedDatePicker, { DateStatus } from '../../../components/EnhancedDatePicker';
import { fetchDateStatusesForMonth } from '../../../utils/dateStatusUtils';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface Appointment { 
  id: string; 
  patient: { user: { name: string }, credibilityScore?: number }; 
  user: { name: string; role: string }; 
  status: string; 
  time: string;
  timeSlot?: { startTime: string; endTime: string; };
  reason?: string;
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
interface PatientSearchResult { id: string; userId: string; name: string; username: string; credibilityScore?: number; }

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
const toYYYYMMDD = (date: Date): string => {
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

// --- Component ---
export default function DoctorSchedulePage() {
  const { data: session, status } = useSession();
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [highlightedDates, setHighlightedDates] = useState<Date[]>([]);
  const [dateStatuses, setDateStatuses] = useState<DateStatus[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [selectedRoomIdForTemplate, setSelectedRoomIdForTemplate] = useState<string>('');
  const [isTemplateApplying, setIsTemplateApplying] = useState(false);
  const [isAddingTimeSlot, setIsAddingTimeSlot] = useState(false);
  const [modifiedTimeSlots, setModifiedTimeSlots] = useState<Set<string>>(new Set());
  const [savingTimeSlots, setSavingTimeSlots] = useState<Set<string>>(new Set());
  const [activeRoomTab, setActiveRoomTab] = useState<string>('');
  const [expandedTimeSlots, setExpandedTimeSlots] = useState<Set<string>>(new Set());
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

  const fetchAllDataForDate = useCallback(async (date: Date) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const profileRes = await fetch('/api/user');
      if (!profileRes.ok) throw new Error('Failed to fetch doctor profile.');
      const userData = await profileRes.json();
      if (!userData.doctorProfile) throw new Error('Doctor profile not found.');
      setDoctorProfile(userData.doctorProfile);

      if (userData.doctorProfile.Room.length > 0 && !selectedRoomIdForTemplate) {
        setSelectedRoomIdForTemplate(userData.doctorProfile.Room[0].id);
      }

      const detailsRes = await fetch(`/api/schedules/details?date=${toYYYYMMDD(date)}`);
      if (!detailsRes.ok) throw new Error('Failed to fetch schedule details.');
      const detailsData = await detailsRes.json();
      setSchedulesForSelectedDay(detailsData);

      const initialCollapsedState: Record<string, boolean> = {};
      detailsData.forEach((schedule: any) => {
        schedule.timeSlots.forEach((slot: any, index: number) => {
          const key = `${schedule.id}-${index}`;
          initialCollapsedState[key] = true;
        });
      });
      setCollapsedSlots(initialCollapsedState);

      if (detailsData.length > 0 && !activeRoomTab) {
        setActiveRoomTab(detailsData[0].room.id);
      }

      const currentMonth = toYYYYMMDD(date).substring(0, 7); // 獲取 YYYY-MM 格式
      const highlightsRes = await fetch(`/api/schedules?month=${currentMonth}`);
      if (!highlightsRes.ok) throw new Error('Failed to fetch highlighted dates.');
      const highlightsData = await highlightsRes.json();
      setHighlightedDates(highlightsData.scheduledDates.map((dateStr: string) => fromYYYYMMDD(dateStr)));

      // 獲取日期狀態數據
      const dateStatusData = await fetchDateStatusesForMonth(
        date.getFullYear(),
        date.getMonth(),
        userData.doctorProfile.id
      );
      setDateStatuses(dateStatusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while fetching data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedRoomIdForTemplate, activeRoomTab]);

  useEffect(() => {
    if (status === 'authenticated') {
      // 在切換日期時，清空所有未保存的本地編輯狀態，確保返回該日期時顯示為資料庫值
      setEditingSlots({});
      setModifiedTimeSlots(new Set());
      setSavingTimeSlots(new Set());
      fetchAllDataForDate(selectedDate);
    }
  }, [selectedDate, status, fetchAllDataForDate]);

  // 監聽月份變化，重新獲取日期狀態數據
  useEffect(() => {
    const fetchDateStatusesForCurrentMonth = async () => {
      if (status === 'authenticated' && doctorProfile) {
        try {
          const dateStatusData = await fetchDateStatusesForMonth(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            doctorProfile.id
          );
          setDateStatuses(dateStatusData);
        } catch (error) {
          console.error('Error fetching date statuses:', error);
        }
      }
    };

    fetchDateStatusesForCurrentMonth();
  }, [selectedDate.getFullYear(), selectedDate.getMonth(), status, doctorProfile]);

  const handleApplyTemplate = async () => {
    if (!selectedRoomIdForTemplate) return;
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
      const templateToAdd = DEFAULT_TEMPLATE.filter(tpl => {
        const isPastStart = isToday && isTimeSlotPast(selectedDate, tpl.startTime);
        const isDuplicate = existingSlots.some(s => s.startTime === tpl.startTime && s.endTime === tpl.endTime);
        return !isPastStart && !isDuplicate;
      });
      const skippedCount = DEFAULT_TEMPLATE.length - templateToAdd.length;
      
      for (const tpl of templateToAdd) {
        // 避免模板床位數超過診室容量
        const maxBedsForRoom = selectedRoom?.bedCount ?? tpl.bedCount;
        const tplBedCount = Math.min(tpl.bedCount, maxBedsForRoom);
        const response = await fetch('/api/schedules', {
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
        ? `模板已應用，已跳過 ${skippedCount} 個過期或重複時段`
        : '模板已應用');
      setIsTemplateModalOpen(false);
    } catch (err) {
      setError('Error applying template.');
    } finally {
      setIsLoading(false);
      setIsTemplateApplying(false);
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
      const response = await fetch(url, {
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
    if (query.length < 2) {
      setSearchedPatients([]);
      return;
    }
    
    try {
      const response = await fetch(`/api/patients/search?q=${encodeURIComponent(query)}`);
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

    // 基本時間校驗：結束時間不可早於或等於開始時間
    if (newTimeSlotData.endTime <= newTimeSlotData.startTime) {
      setError('結束時間不能早於或等於開始時間');
      return;
    }

    let addedOk = false;
    try {
      setIsLoading(true);
      setIsAddingTimeSlot(true);
      setError(null);

      // 自動推斷時段類型：12:00 之前為上午，之後為下午
      const inferredType: 'MORNING' | 'AFTERNOON' = (newTimeSlotData.startTime < '12:00') ? 'MORNING' : 'AFTERNOON';

      const response = await fetch('/api/schedules', {
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
        throw new Error(errorData.error || '新增時段失敗');
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
    } catch (error) {
      setError(error instanceof Error ? error.message : '新增時段失敗');
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
      
      const response = await fetch('/api/appointments', {
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
                    id: `temp-${Date.now()}`,
                    patient: { 
                      user: { name: selectedPatient.name },
                      credibilityScore: selectedPatient.credibilityScore
                    },
                    user: { name: doctorProfile?.name || session?.user?.name || '醫生', role: 'DOCTOR' },
                    status: 'PENDING',
                    time: selectedTimeSlot.startTime,
                    reason: '醫生預約',
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
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to add appointment');
    } finally {
      setIsBookingSubmitting(false);
    }
  };

  const handleDeleteAppointment = async (appointmentId: string, scheduleId: string, slotIndex: number, patientName: string) => {
    if (!confirm(`確定要取消 ${patientName} 的預約嗎？`)) {
      return;
    }

    try {
      const response = await fetch(`/api/appointments?appointmentId=${appointmentId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '取消預約失敗');
      }

      setSchedulesForSelectedDay(
        prev => 
          prev.map(schedule => {
            if (schedule.id === scheduleId) {
              const updatedTimeSlots = [...schedule.timeSlots];
              updatedTimeSlots[slotIndex] = {
                ...updatedTimeSlots[slotIndex],
                availableBeds: updatedTimeSlots[slotIndex].availableBeds + 1,
                appointments: updatedTimeSlots[slotIndex].appointments.filter(
                  appointment => appointment.id !== appointmentId
                )
              };
              return { ...schedule, timeSlots: updatedTimeSlots };
            }
            return schedule;
          })
      );

      setSuccess(`已成功取消 ${patientName} 的預約`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : '取消預約失敗');
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
      const response = await fetch(`/api/appointments/${appointmentId}/no-show`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '標記爽約失敗');
      }

      setSchedulesForSelectedDay(
        prev => 
          prev.map(schedule => {
            if (schedule.id === scheduleId) {
              const updatedTimeSlots = [...schedule.timeSlots];
              updatedTimeSlots[slotIndex] = {
                ...updatedTimeSlots[slotIndex],
                appointments: updatedTimeSlots[slotIndex].appointments.map(
                  appointment => appointment.id === appointmentId 
                    ? { 
                        ...appointment, 
                        status: 'NO_SHOW',
                        // 前端即時更新病人積分，與後端扣除5分保持一致
                        patient: {
                          ...appointment.patient,
                          credibilityScore: ((appointment.patient.credibilityScore ?? 0) - 5)
                        }
                      } 
                    : appointment
                )
              };
              return { ...schedule, timeSlots: updatedTimeSlots };
            }
            return schedule;
          })
      );

      // 同步更新對話框中顯示的積分（若仍在顯示）
      setSelectedAppointmentForNoShow(prev => prev ? { 
        ...prev, 
        credibilityScore: ((prev.credibilityScore ?? 0) - 5) 
      } : prev);

      setSuccess(`已標記 ${patientName} 為爽約並扣分`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : '標記爽約失敗');
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

    const key = `${scheduleId}-${timeSlotId}`;
    setDeletingSlots(prev => new Set([...prev, key]));
    setError(null);

    try {
      const deleteUrl = `/api/schedules?timeSlotId=${timeSlotId}`;
      const response = await fetch(deleteUrl, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete time slot');
      }

      setSchedulesForSelectedDay(
        prev => 
          prev.map(schedule => {
            if (schedule.id === scheduleId) {
              return {
                ...schedule,
                timeSlots: schedule.timeSlots.filter(slot => slot.id !== timeSlotId)
              };
            }
            return schedule;
          })
      );

      setSuccess('Time slot deleted successfully!');
      setTimeout(() => setSuccess(null), 3000);
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
    const roomMap = new Map();
    schedulesForSelectedDay.forEach(schedule => {
      if (!roomMap.has(schedule.room.id)) {
        roomMap.set(schedule.room.id, schedule.room);
      }
    });
    return Array.from(roomMap.values());
  }, [schedulesForSelectedDay]);

  const activeSchedules = useMemo(() => {
    return schedulesForSelectedDay.filter(schedule => schedule.room.id === activeRoomTab);
  }, [schedulesForSelectedDay, activeRoomTab]);

  if (isLoading && !doctorProfile) return (
    <div className="mobile-loading">
      <div className="mobile-loading-spinner"></div>
    </div>
  );
  if (error) return (
    <div className="mobile-message mobile-message-error">
      錯誤: {error}
    </div>
  );
  if (!doctorProfile) return (
    <div className="mobile-message mobile-message-error">
      無法載入醫生資訊
    </div>
  );

  return (
    <div className="page-container space-y-2">
      <div className="mobile-card">
        <div className="w-full flex justify-between items-center mb-2">
          <p className="text-xs text-gray-500">{doctorProfile.name}</p>
        </div>
        <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'center', width: '100%' }}>
          <EnhancedDatePicker
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            dateStatuses={dateStatuses}
            isLoading={isLoading}
          />
        </div>

        {success && (
          <div className="mobile-toast mobile-toast-success">
            {success}
          </div>
        )}

        {error && (
          <div className="mobile-toast mobile-toast-error">
            {error}
          </div>
        )}
        
        <div className="w-full grid grid-cols-2 gap-2">
          <button
            onClick={() => setIsTemplateModalOpen(true)}
            className="mobile-btn mobile-btn-primary w-full flex items-center justify-center space-x-2"
            title="使用模板填充"
          >
            <FaPlusCircle className="w-4 h-4" />
            <span>使用模板填充</span>
          </button>
          <button
            onClick={() => setIsAddTimeSlotModalOpen(true)}
            className="mobile-btn mobile-btn-success w-full flex items-center justify-center space-x-2"
            title="新增自定義時段"
          >
            <FaPlusCircle className="w-4 h-4" />
            <span>新增自定義時段</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="mobile-loading">
          <div className="mobile-loading-spinner"></div>
        </div>
      ) : schedulesForSelectedDay.length === 0 ? (
        <div className="mobile-empty-state">
          <h3>今日無排程</h3>
          <p>請選擇其他日期或新增排程</p>
        </div>
      ) : (
        <div className="space-y-2 w-full flex flex-col items-center">
          {/* 手機端診室選擇 - 使用下拉選單而非標籤頁 */}
          <div className="mobile-card">
            <label className="block text-sm font-medium text-gray-700 mb-2">選擇診室</label>
            <select
              value={activeRoomTab}
              onChange={(e) => setActiveRoomTab(e.target.value)}
              className="mobile-input w-full"
            >
              {uniqueRooms.map(room => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>

          {activeSchedules.map(schedule => (
            <div key={schedule.id} className="mobile-card space-y-2">
              <div className="mobile-section-header">
                <h3 className="text-lg font-semibold">診室: {schedule.room.name}</h3>
              </div>
              
              {schedule.timeSlots && Array.isArray(schedule.timeSlots) ? schedule.timeSlots.map((slot, index) => {
                const key = `${schedule.id}-${index}`;
                const isModified = modifiedTimeSlots.has(key);
                const isSaving = savingTimeSlots.has(key);
                const isExpanded = expandedTimeSlots.has(key);
                const editedStart = getSlotValue(schedule.id, index, 'startTime', slot.startTime) as string;
                const editedEnd = getSlotValue(schedule.id, index, 'endTime', slot.endTime) as string;
                const editedBedCount = Number(getSlotValue(schedule.id, index, 'bedCount', slot.bedCount));
                const isValidEdit = !!editedStart && !!editedEnd && (editedEnd > editedStart) && editedBedCount > 0 && editedBedCount <= schedule.room.bedCount;
                const isPast = isTimeSlotPast(selectedDate, slot.startTime);

                return (
                  <div key={index} className={`mobile-time-slot-single-line ${
                    isPast ? 'mobile-time-slot-past' : (!isPast && isModified ? 'mobile-time-slot-modified' : '')
                  }`}>
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
                        className="mobile-time-input-inline mobile-time-input-fluid"
                        disabled={isPast}
                        title={isPast ? '時間已過，不可編輯' : '開始時間'}
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
                        className="mobile-time-input-inline mobile-time-input-fluid"
                        disabled={isPast}
                        title={isPast ? '時間已過，不可編輯' : '結束時間'}
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
                        className="mobile-total-input-inline mobile-total-input-fluid"
                        placeholder="床位數"
                        disabled={isPast}
                        title={isPast ? '時間已過，不可編輯' : `可預約人數（最大 ${schedule.room.bedCount}）`}
                      />

                      {/* 預約狀態信息 */}
                      <div className="mobile-slot-info-inline mobile-slot-info-fluid">
                        <span className={`font-semibold ${
                          slot.availableBeds <= 0 ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {slot.bedCount - slot.availableBeds}/{slot.bedCount}
                        </span>
                      </div>
                    </div>

                    {/* 第二行：操作按鈕 */}
                    <div className="mobile-slot-actions-row mobile-slot-actions-row-grid">
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
                            ? "時間已過，無法預約" 
                            : (slot.availableBeds <= 0 ? "已滿額" : "新增預約")
                        }
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {/* 儲存按鈕 */}
                      <button
                        type="button"
                        onClick={() => handleSaveTimeSlot(schedule.id, index)}
                        disabled={isPast || !isModified || isSaving || !isValidEdit}
                        className={`mobile-icon-btn-colored ${
                          !isPast && isModified && !isSaving && isValidEdit
                            ? 'mobile-icon-btn-save-colored'
                            : 'mobile-icon-btn-disabled-colored'
                        }`}
                        title={isPast ? '時間已過，不可編輯' : (isModified ? (isValidEdit ? "儲存變更" : "時間或床位數不合法") : "無變更")}
                      >
                        {isSaving ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
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
                        disabled={isPast || isSaving}
                        className={`mobile-icon-btn-colored mobile-icon-btn-delete-colored ${
                          (isPast || isSaving) ? 'mobile-icon-btn-disabled-colored' : ''
                        }`}
                        title={isPast ? '時間已過，不可刪除' : '刪除時段'}
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {/* 展開患者列表按鈕 */}
                      <button
                        type="button"
                        onClick={() => {
                          if (slot.appointments.length > 0) {
                            const newExpanded = new Set(expandedTimeSlots);
                            if (isExpanded) {
                              newExpanded.delete(key);
                            } else {
                              newExpanded.add(key);
                            }
                            setExpandedTimeSlots(newExpanded);
                          }
                        }}
                        className={`mobile-icon-btn-colored ${
                          slot.appointments.length > 0 
                            ? 'mobile-icon-btn-expand' 
                            : 'mobile-icon-btn-expand-disabled'
                        }`}
                        disabled={slot.appointments.length === 0}
                        title={
                          slot.appointments.length === 0 
                            ? '暫無預約患者' 
                            : (isExpanded ? '收合患者列表' : '展開患者列表')
                        }
                      >
                        <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>

                    {/* 已預約患者列表 - 下拉顯示 */}
                    {slot.appointments.length > 0 && isExpanded && (
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

                          const statusKey = appointment.status === 'CONFIRMED' ? 'PENDING' : appointment.status;
                          const statusText = getStatusText(statusKey);
                          const statusClassKey = statusKey.toLowerCase().replace('_', '-');

                          return (
                            <div key={apptIndex} className={`mobile-patient-item-inline ${statusKey === 'NO_SHOW' ? 'mobile-status-no-show' : ''}`}>
                              <div className="mobile-patient-info-inline">
                                <span className="mobile-patient-name-inline">{appointment.patient.user.name}</span>
                                <span className="ml-2 text-xs text-gray-600">積分：{appointment.patient.credibilityScore ?? '未知'}</span>
                                <span className="mobile-patient-details-inline">
                                  操作時間：{operatedAtString} 操作員：{
                                    // 使用歷史記錄的操作者，否則依據 reason 與當前醫生資訊推斷
                                    appointment.history && appointment.history.length > 0 
                                      ? appointment.history[0].operatorName
                                      : ((appointment.reason === '醫生預約')
                                          ? (doctorProfile?.name || session?.user?.name || '醫生')
                                          : appointment.patient.user.name)
                                  } 角色：{
                                    (appointment.history && appointment.history.length > 0)
                                      ? ((appointment.reason === '醫生預約') ? '醫生' : '患者')
                                      : ((appointment.reason === '醫生預約' || appointment.user.role === 'DOCTOR') ? '醫生' : '患者')
                                  } 狀態：<span className={`mobile-status-badge mobile-status-${statusClassKey}`}>{statusText}</span>
                                </span>
                              </div>
                              {!isPast && appointment.status === 'PENDING' && (
                                <button
                                  onClick={() => handleDeleteAppointment(appointment.id, schedule.id, index, appointment.patient.user.name)}
                                  className="mobile-patient-delete-btn-inline"
                                  title="取消預約"
                                >
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              )}
                              {isPast && appointment.status !== 'NO_SHOW' && appointment.status !== 'CANCELLED' && (
                                <button
                                  onClick={() => openNoShowDialog(appointment, schedule, index)}
                                  className="mobile-patient-delete-btn-inline"
                                  title="標記爽約"
                                >
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16z" clipRule="evenodd" />
                                    <path fillRule="evenodd" d="M7 10a3 3 0 116 0 3 3 0 01-6 0z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div className="mobile-empty-state">
                  <h3>無可用時段</h3>
                  <p>目前沒有安排任何時段</p>
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
              <h2>選擇診室套用模板</h2>
            </div>
            <div className="mobile-modal-content grid grid-cols-1 sm:grid-cols-2 gap-3">
              {doctorProfile?.Room && doctorProfile.Room.length > 0 ? (
                <div>
                  <label htmlFor="room-template" className="block text-sm font-medium mb-2">診室</label>
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
                <div className="text-center py-4">
                  <div className="text-gray-400 text-lg mb-2">🏥</div>
                  <p className="text-gray-500 text-sm">醫生名下沒有診室</p>
                  <p className="text-gray-400 text-xs mt-1">請聯繫管理員分配診室</p>
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
                        {patient.name} ({patient.username})
                        <span className="ml-2 text-xs text-gray-600">積分：{patient.credibilityScore ?? '未知'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedPatient && (
                <div className="mobile-selected-patient">
                  <div className="text-sm text-gray-600">已選擇患者:</div>
                  <div className="font-medium">{selectedPatient.name} ({selectedPatient.username})</div>
                  <div className="text-sm mt-1">積分：{selectedPatient.credibilityScore ?? '未知'}</div>
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
                {isBookingSubmitting ? '確認中…' : '確認預約'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNoShowDialog && selectedAppointmentForNoShow && (
        <div className="mobile-dialog-overlay">
          <div className="mobile-dialog">
            <div className="mobile-dialog-header">
              <h3 className="mobile-dialog-title">確認標記爽約</h3>
              <button onClick={closeNoShowDialog} className="mobile-dialog-close-btn" aria-label="關閉" disabled={noShowLoading}>×</button>
            </div>
            <div className="mobile-dialog-content">
              <p className="mobile-dialog-text">將標記 {selectedAppointmentForNoShow.patientName} 爽約並扣除信用分。</p>
              <div className="mobile-dialog-details">
                <div className="mobile-dialog-detail-row">
                  <span className="mobile-dialog-detail-label">日期</span>
                  <span className="mobile-dialog-detail-value">{formatDate(selectedAppointmentForNoShow.date)}</span>
                </div>
                <div className="mobile-dialog-detail-row">
                  <span className="mobile-dialog-detail-label">時間</span>
                  <span className="mobile-dialog-detail-value">{selectedAppointmentForNoShow.time}</span>
                </div>
                <div className="mobile-dialog-detail-row">
                  <span className="mobile-dialog-detail-label">診室</span>
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
                  {noShowLoading ? '提交中…' : '確認標記爽約'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddTimeSlotModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal mobile-modal-compact">
            <div className="mobile-modal-header">
              <h2 className="text-xl font-bold">新增時段</h2>
            </div>
            <div className="mobile-modal-content space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">診室</label>
                <select
                  value={selectedRoomIdForTemplate}
                  onChange={(e) => setSelectedRoomIdForTemplate(e.target.value)}
                  className="mobile-input w-full"
                  required
                >
                  <option value="">請選擇診室</option>
                  {doctorProfile?.Room?.map(room => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium mb-2">時間</label>
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
              </div>
              
              
              
              <div>
                <label className="block text-sm font-medium mb-2">可預約人數</label>
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
                  placeholder="請輸入可預約人數（不超過診室床位數）"
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
                disabled={isAddingTimeSlot || !selectedRoomIdForTemplate || !newTimeSlotData.startTime || !newTimeSlotData.endTime || !newTimeSlotData.bedCount || (newTimeSlotData.endTime <= newTimeSlotData.startTime)}
                className="mobile-btn mobile-btn-success flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-busy={isAddingTimeSlot}
              >
                {isAddingTimeSlot ? '提交中…' : '新增時段'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
