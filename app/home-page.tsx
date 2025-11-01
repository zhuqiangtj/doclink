'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from 'next-auth';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './mobile.css';

// --- Interfaces ---
interface Doctor { id: string; name: string; }
interface Room { id: string; name: string; }
interface TimeSlot { time: string; total: number; booked: number; }
interface Schedule {
  id: string;
  date: string;
  room: Room;
  timeSlots: TimeSlot[];
}

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

interface Appointment {
  date: string;
  time: string;
}

interface Appointment {
  date: string;
  time: string;
}

// --- Component ---
export default function HomePage({ session }: { session: Session | null }) {
  const router = useRouter();

  // --- Data States ---
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [highlightedDates, setHighlightedDates] = useState<Date[]>([]);
  const [schedulesForDay, setSchedulesForDay] = useState<Schedule[]>([]);
  const [myAppointments, setMyAppointments] = useState<string[]>([]); // Stores as "date-time"

  // --- UI States ---
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>('');

  // --- Modal States ---
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ schedule: Schedule; time: string } | null>(null);

  // --- Initial Data Load ---
  useEffect(() => {
    if (!session) {
      router.push('/auth/signin');
      return;
    }
    if (session.user.role !== 'PATIENT') {
      router.push('/doctor/schedule'); // Or admin dashboard
      return;
    }

    const fetchInitialData = async () => {
      try {
        const [doctorsRes, userRes, appointmentsRes] = await Promise.all([
          fetch('/api/doctors'),
          fetch(`/api/user/${session.user.id}`),
          fetch('/api/appointments')
        ]);

        if (!doctorsRes.ok) throw new Error("获取医生列表失败。");
        setDoctors(await doctorsRes.json());

        if (!userRes.ok) throw new Error("获取用户资料失败。");
        const userData = await userRes.json();
        if (!userData.patientProfile) throw new Error("未找到患者资料。");
        setPatientId(userData.patientProfile.id);

        if (!appointmentsRes.ok) throw new Error("获取我的预约失败。");
        const appointmentsData: Appointment[] = await appointmentsRes.json();
        setMyAppointments(appointmentsData && Array.isArray(appointmentsData) ? appointmentsData.map((apt) => `${apt.date}-${apt.time}`) : []);

      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    };
    fetchInitialData();
  }, [session, router]);

  // --- Fetch Schedules on Selection Change ---
  const fetchSchedules = useCallback(async () => {
    if (!selectedDoctorId) return;

    setIsLoading(true);
    setError(null);

    try {
      const month = selectedDate ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}` : undefined;
      const date = selectedDate ? toYYYYMMDD(selectedDate) : undefined;

      const [highlightsRes, detailsRes] = await Promise.all([
        fetch(`/api/public/schedules?doctorId=${selectedDoctorId}&month=${month}`),
        date ? fetch(`/api/public/schedules?doctorId=${selectedDoctorId}&date=${date}`) : Promise.resolve(null)
      ]);

      if (!highlightsRes.ok) throw new Error("获取医生排班失败。");
      const highlightsData = await highlightsRes.json();
      setHighlightedDates(highlightsData && highlightsData.highlightedDates && Array.isArray(highlightsData.highlightedDates) ? highlightsData.highlightedDates.map(fromYYYYMMDD) : []);

      if (detailsRes) {
        if (!detailsRes.ok) throw new Error("获取当天排班详情失败。");
        setSchedulesForDay(await detailsRes.json());
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    } finally {
      setIsLoading(false);
    }
  }, [selectedDoctorId, selectedDate]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  // --- Handlers ---
  const handleBooking = async () => {
    if (!selectedSlot || !patientId || !session) return;
    setError(null);
    setSuccessMessage('');

    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: session.user.id,
          patientId: patientId,
          doctorId: selectedDoctorId,
          scheduleId: selectedSlot.schedule.id,
          time: selectedSlot.time,
          roomId: selectedSlot.schedule.room.id,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "预约失败，该时间点可能已被预约。");
      }

      setSuccessMessage(`成功预约 ${selectedSlot.time} 的号！`);
      setIsConfirmModalOpen(false);
      setSelectedSlot(null);
      await fetchSchedules(); // Refresh data
      const appointmentsRes = await fetch('/api/appointments');
              const appointmentsData: Appointment[] = await appointmentsRes.json();
              setMyAppointments(appointmentsData && Array.isArray(appointmentsData) ? appointmentsData.map((apt) => `${apt.date}-${apt.time}`) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  if (!session) return <main className="mobile-loading-container">正在跳转到登录页面...</main>;

  return (
    <main className="page-container">
      <h1 className="mobile-header">预约挂号</h1>

      <div className="mobile-step-card">
        <label htmlFor="doctor-select" className="mobile-step-label">第一步: 选择医生</label>
        <select id="doctor-select" value={selectedDoctorId} onChange={(e) => { setSelectedDoctorId(e.target.value); setSelectedDate(new Date()); }} className="mobile-doctor-select">
          <option value="">-- 请选择一位医生 --</option>
          {doctors && Array.isArray(doctors) ? doctors.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>) : null}
        </select>
      </div>

        {selectedDoctorId && (
          <div className="mobile-grid">
            <div className="mobile-date-picker-card">
              <h2 className="mobile-step-title">第二步: 选择日期</h2>
              <DatePicker selected={selectedDate} onChange={(date: Date) => setSelectedDate(date)} inline highlightDates={highlightedDates} minDate={new Date()} />
            </div>
            <div className="mobile-time-slots-card">
              <h2 className="mobile-step-title">第三步: 选择时间</h2>
              {isLoading && <p className="mobile-loading-text">正在加载时间点...</p>}
              {error && <p className="mobile-error-text">{error}</p>}
              <div className="space-y-4">
                {schedulesForDay && Array.isArray(schedulesForDay) && schedulesForDay.length > 0 ? (
                  schedulesForDay.map(schedule => (
                    <div key={schedule.id} className="mobile-schedule-container">
                      <h3 className="mobile-room-title">{schedule.room.name}</h3>
                      <div className="mobile-time-grid">
                        {schedule.timeSlots && Array.isArray(schedule.timeSlots) ? schedule.timeSlots.map(slot => {
                          const isBookedByMe = myAppointments.includes(`${schedule.date}-${slot.time}`);
                          const isFull = slot.booked >= slot.total;
                          return (
                            <button 
                              key={slot.time} 
                              disabled={isFull || isBookedByMe}
                              onClick={() => { setSelectedSlot({ schedule, time: slot.time }); setIsConfirmModalOpen(true); }}
                              className={`mobile-time-slot ${isBookedByMe ? 'booked' : isFull ? 'full' : ''}`}>
                              {slot.time}
                              <span className="mobile-time-slot-info">{isBookedByMe ? '已预约' : `余 ${slot.total - slot.booked}`}</span>
                            </button>
                          );
                        }) : (
                          <p className="mobile-no-slots">暂无可用时间段</p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="mobile-no-selection">請先選擇醫生和日期</p>
                )}
              </div>
            </div>
          </div>
        )}

        {successMessage && <div className="mobile-success-message">{successMessage}</div>}

      {isConfirmModalOpen && selectedSlot && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <h2 className="mobile-modal-title">确认预约</h2>
            <p className="mobile-modal-info">医生: {doctors.find(d => d.id === selectedDoctorId)?.name}</p>
            <p className="mobile-modal-info">日期: {selectedDate?.toLocaleDateString()}</p>
            <p className="mobile-modal-info">时间: {selectedSlot.time}</p>
            <div className="mobile-modal-actions">
              <button type="button" onClick={() => setIsConfirmModalOpen(false)} className="mobile-modal-btn mobile-modal-btn-cancel">取消</button>
              <button onClick={handleBooking} className="mobile-modal-btn mobile-modal-btn-confirm">确定</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}