'use client';

import { useState, useEffect, useCallback, FormEvent, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './mobile.css';
import { FaTrash, FaSave, FaUserPlus, FaPlusCircle } from 'react-icons/fa';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface Appointment { 
  id: string; 
  patient: { user: { name: string } }; 
  user: { name: string; role: string }; 
  status: string; 
  time: string; 
}
interface TimeSlot { time: string; total: number; appointments: Appointment[]; }
interface Schedule {
  id: string;
  date: string;
  room: Room;
  timeSlots: TimeSlot[];
}
interface PatientSearchResult { id: string; userId: string; name: string; username: string; }

const DEFAULT_TIMES = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

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

// --- Component ---
export default function DoctorSchedulePage() {
  const { data: session, status } = useSession();
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [highlightedDates, setHighlightedDates] = useState<Date[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [selectedRoomIdForTemplate, setSelectedRoomIdForTemplate] = useState<string>('');
  const [modifiedTimeSlots, setModifiedTimeSlots] = useState<Set<string>>(new Set());
  const [savingTimeSlots, setSavingTimeSlots] = useState<Set<string>>(new Set());
  const [activeRoomTab, setActiveRoomTab] = useState<string>('');
  const [expandedTimeSlots, setExpandedTimeSlots] = useState<Set<string>>(new Set());
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedScheduleForBooking, setSelectedScheduleForBooking] = useState<Schedule | null>(null);
  const [selectedSlotIndexForBooking, setSelectedSlotIndexForBooking] = useState<number | null>(null);
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [searchedPatients, setSearchedPatients] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [isAddTimeSlotModalOpen, setIsAddTimeSlotModalOpen] = useState(false);
  const [newTimeSlotData, setNewTimeSlotData] = useState({ time: '', total: '' });
  const [collapsedSlots, setCollapsedSlots] = useState<{[key: string]: boolean}>({});
  const [editingSlots, setEditingSlots] = useState<{[key: string]: any}>({});
  const [deletingSlots, setDeletingSlots] = useState<Set<string>>(new Set());

  const getSlotValue = (scheduleId: string, slotIndex: number, field: 'time' | 'total' | 'roomId', originalValue: any) => {
    const key = `${scheduleId}-${slotIndex}`;
    return editingSlots[key]?.[field] ?? originalValue;
  };

  const updateSlotEdit = (scheduleId: string, slotIndex: number, field: 'time' | 'total' | 'roomId', value: string | number) => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while fetching data');
    } finally {
      setIsLoading(false);
    }
  }, [selectedRoomIdForTemplate, activeRoomTab]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchAllDataForDate(selectedDate);
    }
  }, [selectedDate, status, fetchAllDataForDate]);

  const handleApplyTemplate = async () => {
    if (!selectedRoomIdForTemplate) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const selectedRoom = doctorProfile?.Room.find(room => room.id === selectedRoomIdForTemplate);
      
      for (const time of DEFAULT_TIMES) {
        const response = await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: toYYYYMMDD(selectedDate),
            time,
            total: selectedRoom?.bedCount || 1,
            roomId: selectedRoomIdForTemplate
          })
        });
        
        if (response.ok) {
          const newSchedule = await response.json();
          
          setSchedulesForSelectedDay(prev => {
            const existingSchedule = prev.find(s => s.room.id === selectedRoomIdForTemplate);
            
            if (existingSchedule) {
              return prev.map(s => 
                s.id === existingSchedule.id 
                  ? { ...s, timeSlots: [...s.timeSlots, { time, total: selectedRoom?.bedCount || 1, appointments: [] }] }
                  : s
              );
            } else {
              const room = doctorProfile?.Room.find(r => r.id === selectedRoomIdForTemplate);
              if (room) {
                return [...prev, {
                  id: newSchedule.id,
                  date: toYYYYMMDD(selectedDate),
                  room,
                  timeSlots: [{ time, total: selectedRoom?.bedCount || 1, appointments: [] }]
                }];
              }
              return prev;
            }
          });
        }
      }
      
      setSuccess('Template applied successfully!');
      setIsTemplateModalOpen(false);
    } catch (err) {
      setError('Error applying template.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTimeSlot = async (scheduleId: string, slotIndex: number) => {
    const key = `${scheduleId}-${slotIndex}`;
    const editedSlot = editingSlots[key];
    if (!editedSlot) return;

    const schedule = schedulesForSelectedDay.find(s => s.id === scheduleId);
    if (!schedule) return;

    setSavingSlots(prev => new Set([...prev, key]));
    setError(null);

    try {
      // 由於診室選擇已被禁用，我們不再處理房間變更的情況
      // 直接更新現有的時間段
      const url = `/api/schedules?scheduleId=${scheduleId}&time=${schedule.timeSlots[slotIndex].time}`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          time: editedSlot.time || schedule.timeSlots[slotIndex].time,
          total: editedSlot.total || schedule.timeSlots[slotIndex].total,
          roomId: schedule.room.id // 直接使用原始的 roomId，因為診室選擇已被禁用
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save time slot');
      }

      setSchedulesForSelectedDay(prev => 
        prev.map(s => 
          s.id === scheduleId 
            ? {
                ...s,
                timeSlots: s.timeSlots.map((slot, idx) => 
                  idx === slotIndex 
                    ? {
                        ...slot,
                        time: editedSlot.time || slot.time,
                        total: editedSlot.total || slot.total
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

      setSuccess('Time slot saved successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`Error saving time slot: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSavingSlots(prev => {
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
    if (!selectedRoomIdForTemplate || !newTimeSlotData.time || !newTimeSlotData.total) {
      setError('請填寫所有必需字段');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: toYYYYMMDD(selectedDate),
          roomId: selectedRoomIdForTemplate,
          time: newTimeSlotData.time,
          total: parseInt(newTimeSlotData.total)
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '新增時段失敗');
      }

      const newScheduleData = await response.json();

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
                time: newTimeSlotData.time,
                total: parseInt(newTimeSlotData.total),
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
              id: newScheduleData.id,
              date: toYYYYMMDD(selectedDate),
              room: selectedRoom,
              timeSlots: [{
                time: newTimeSlotData.time,
                total: parseInt(newTimeSlotData.total),
                appointments: []
              }]
            }];
          }
          return prev;
        }
      });

      // 關閉模態框並重置表單
      setIsAddTimeSlotModalOpen(false);
      setNewTimeSlotData({ time: '', total: '' });
      
      setSuccess('時段新增成功');
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : '新增時段失敗');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBookingSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!selectedPatient || !selectedScheduleForBooking || selectedSlotIndexForBooking === null || !doctorProfile) {
      setError('Please select patient and time slot');
      return;
    }
    
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedPatient.userId,
          patientId: selectedPatient.id,
          doctorId: doctorProfile.id,
          scheduleId: selectedScheduleForBooking.id,
          time: selectedScheduleForBooking.timeSlots[selectedSlotIndexForBooking].time,
          roomId: selectedScheduleForBooking.room.id
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Booking failed');
      }

      setSchedulesForSelectedDay(
        prev => 
          prev.map(schedule => {
            if (schedule.id === selectedScheduleForBooking.id) {
              const updatedTimeSlots = [...schedule.timeSlots];
              updatedTimeSlots[selectedSlotIndexForBooking] = {
                ...updatedTimeSlots[selectedSlotIndexForBooking],
                appointments: [
                  ...updatedTimeSlots[selectedSlotIndexForBooking].appointments,
                  {
                    id: `temp-${Date.now()}`,
                    patient: { user: { name: selectedPatient.name } },
                    user: { name: doctorProfile?.name || 'Doctor', role: 'DOCTOR' },
                    status: 'CONFIRMED',
                    time: selectedScheduleForBooking.timeSlots[selectedSlotIndexForBooking].time
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

  const toggleCollapse = (scheduleId: string, slotIndex: number) => {
    const key = `${scheduleId}-${slotIndex}`;
    setCollapsedSlots(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleDeleteTimeSlot = async (scheduleId: string, time: string) => {
    if (!confirm('Are you sure you want to delete this time slot?')) {
      return;
    }

    const key = `${scheduleId}-${time}`;
    setDeletingSlots(prev => new Set([...prev, key]));
    setError(null);

    try {
      const deleteUrl = `/api/schedules?scheduleId=${scheduleId}&time=${time}`;
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
                timeSlots: schedule.timeSlots.filter(slot => slot.time !== time)
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
    return Array.from(new Set(schedulesForSelectedDay.map(s => s.room)));
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
    <div className="page-container space-y-4">
      <div className="mobile-header">
        <h1 className="text-2xl md:text-4xl font-bold text-foreground">
          醫生排程
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          {doctorProfile.name}
        </p>
      </div>
      
      <div className="mobile-card space-y-4">
        <div className="flex flex-col space-y-3">
          <label className="text-sm font-medium text-gray-700">選擇日期</label>
          <DatePicker
            selected={selectedDate}
            onChange={(date: Date | null) => date && setSelectedDate(date)}
            highlightDates={highlightedDates}
            className="mobile-input w-full"
            dateFormat="yyyy/MM/dd"
          />
        </div>
        
        <button
          onClick={() => setIsTemplateModalOpen(true)}
          className="mobile-btn mobile-btn-primary w-full flex items-center justify-center space-x-2"
          title="使用模板填充"
        >
          <FaPlusCircle className="w-4 h-4" />
          <span>使用模板填充</span>
        </button>
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
        <div className="space-y-4 w-full flex flex-col items-center">
          {/* 手機端房間選擇 - 使用下拉選單而非標籤頁 */}
          <div className="mobile-card">
            <label className="block text-sm font-medium text-gray-700 mb-2">選擇房間</label>
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
            <div key={schedule.id} className="mobile-card space-y-4">
              <div className="mobile-section-header">
                <h3 className="text-lg font-semibold">房間: {schedule.room.name}</h3>
              </div>
              
              {schedule.timeSlots && Array.isArray(schedule.timeSlots) ? schedule.timeSlots.map((slot, index) => {
                const key = `${schedule.id}-${index}`;
                const isModified = modifiedTimeSlots.has(key);
                const isSaving = savingTimeSlots.has(key);
                const isExpanded = expandedTimeSlots.has(key);

                return (
                  <div key={index} className={`mobile-time-slot-single-line ${
                    isModified ? 'mobile-time-slot-modified' : ''
                  }`}>
                    {/* 第一行：時間點信息 */}
                    <div className="mobile-time-slot-info-row">
                      {/* 時間輸入 */}
                      <input
                        type="time"
                        value={getSlotValue(schedule.id, index, 'time', slot.time)}
                        onChange={(e) => {
                          updateSlotEdit(schedule.id, index, 'time', e.target.value);
                          setModifiedTimeSlots(prev => new Set(prev).add(key));
                        }}
                        className="mobile-time-input-inline"
                      />
                      
                      {/* 床位輸入 */}
                      <input
                        type="number"
                        min="1"
                        value={getSlotValue(schedule.id, index, 'total', slot.total)}
                        onChange={(e) => {
                          updateSlotEdit(schedule.id, index, 'total', parseInt(e.target.value));
                          setModifiedTimeSlots(prev => new Set(prev).add(key));
                        }}
                        className="mobile-total-input-inline"
                        placeholder="床位數"
                      />

                      {/* 預約狀態信息 */}
                      <div className="mobile-slot-info-inline">
                        <span className={`font-semibold ${
                          slot.appointments.length >= slot.total ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {slot.appointments.length}/{slot.total}
                        </span>
                      </div>
                    </div>

                    {/* 第二行：操作按鈕 */}
                    <div className="mobile-slot-actions-row">
                      {/* 新增按鈕 */}
                      <button
                        onClick={() => handleAddAppointment(schedule, index)}
                        className={`mobile-icon-btn-colored ${
                          slot.appointments.length >= slot.total 
                            ? 'mobile-icon-btn-disabled-colored' 
                            : 'mobile-icon-btn-success'
                        }`}
                        disabled={slot.appointments.length >= slot.total}
                        title="新增預約"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {/* 儲存按鈕 */}
                      <button
                        onClick={() => handleSaveTimeSlot(schedule.id, index)}
                        disabled={!isModified || isSaving}
                        className={`mobile-icon-btn-colored ${
                          isModified && !isSaving
                            ? 'mobile-icon-btn-save-colored'
                            : 'mobile-icon-btn-disabled-colored'
                        }`}
                        title={isModified ? "儲存變更" : "無變更"}
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
                        onClick={() => handleDeleteTimeSlot(schedule.id, slot.time)}
                        disabled={isSaving}
                        className={`mobile-icon-btn-colored mobile-icon-btn-delete-colored ${
                          isSaving ? 'mobile-icon-btn-disabled-colored' : ''
                        }`}
                        title="刪除時段"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {/* 展開患者列表按鈕 */}
                      <button
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
                        {slot.appointments.map((appointment, apptIndex) => (
                          <div key={apptIndex} className="mobile-patient-item-inline">
                            <div className="mobile-patient-info-inline">
                              <span className="mobile-patient-name-inline">{appointment.patient.user.name}</span>
                              <span className="mobile-patient-details-inline">
                                預約者: {appointment.user.name} ({appointment.user.role === 'DOCTOR' ? '醫生' : '患者'}) | 狀態: {appointment.status}
                              </span>
                            </div>
                            {appointment.status === 'PENDING' && (
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
                          </div>
                        ))}
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
              
              <button 
                onClick={() => {
                  setIsAddTimeSlotModalOpen(true);
                }}
                className="mobile-btn mobile-btn-outline w-full flex items-center justify-center space-x-2"
                title="新增時段"
              >
                <FaPlusCircle className="w-4 h-4" />
                <span>新增時段</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {isTemplateModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <div className="mobile-modal-header">
              <h2 className="text-xl font-bold">選擇房間套用模板</h2>
            </div>
            <div className="mobile-modal-content space-y-4">
              <div>
                <label htmlFor="room-template" className="block text-sm font-medium mb-2">房間</label>
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
            </div>
            <div className="mobile-modal-footer">
              <button 
                type="button" 
                onClick={() => setIsTemplateModalOpen(false)} 
                className="mobile-btn mobile-btn-secondary flex-1"
              >
                取消
              </button>
              <button 
                onClick={handleApplyTemplate} 
                className="mobile-btn mobile-btn-primary flex-1"
              >
                套用
              </button>
            </div>
          </div>
        </div>
      )}

      {isBookingModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal mobile-modal-large">
            <div className="mobile-modal-header">
              <h2 className="text-xl font-bold">新增預約</h2>
            </div>
            <form onSubmit={handleBookingSubmit} className="mobile-modal-content space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">時間</label>
                <input
                  type="text"
                  value={selectedScheduleForBooking?.timeSlots[selectedSlotIndexForBooking || 0]?.time || ''}
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
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedPatient && (
                <div className="mobile-selected-patient">
                  <div className="text-sm text-gray-600">已選擇患者:</div>
                  <div className="font-medium">{selectedPatient.name} ({selectedPatient.username})</div>
                </div>
              )}
            </form>
            <div className="mobile-modal-footer">
              <button
                type="button"
                onClick={() => setIsBookingModalOpen(false)}
                className="mobile-btn mobile-btn-secondary flex-1"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!selectedPatient}
                className="mobile-btn mobile-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleBookingSubmit}
              >
                確認預約
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddTimeSlotModalOpen && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <div className="mobile-modal-header">
              <h2 className="text-xl font-bold">新增時段</h2>
            </div>
            <div className="mobile-modal-content space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">診室</label>
                <input
                  type="text"
                  value={doctorProfile?.Room.find(r => r.id === selectedRoomIdForTemplate)?.name || ''}
                  readOnly
                  className="mobile-input w-full bg-gray-100"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">時間</label>
                <input
                  type="time"
                  value={newTimeSlotData.time}
                  onChange={(e) => setNewTimeSlotData(prev => ({ ...prev, time: e.target.value }))}
                  className="mobile-input w-full"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  可預約人數
                  <span className="text-xs text-gray-500 ml-2">(此時段最多可預約的患者數量)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={newTimeSlotData.total}
                  onChange={(e) => setNewTimeSlotData(prev => ({ ...prev, total: e.target.value }))}
                  className="mobile-input w-full"
                  placeholder="請輸入可預約人數 (1-50)"
                  required
                />
              </div>
            </div>
            <div className="mobile-modal-footer">
              <button
                type="button"
                onClick={() => {
                  setIsAddTimeSlotModalOpen(false);
                  setNewTimeSlotData({ time: '', total: '' });
                }}
                className="mobile-btn mobile-btn-outline flex-1"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddTimeSlot}
                disabled={!selectedRoomIdForTemplate || !newTimeSlotData.time || !newTimeSlotData.total}
                className="mobile-btn mobile-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                新增時段
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
