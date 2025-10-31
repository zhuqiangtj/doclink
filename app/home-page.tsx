'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from 'next-auth';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

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

  if (!session) return <main className="container mx-auto p-8 text-center">正在跳转到登录页面...</main>;

  return (
    <main className="container mx-auto p-6 md:p-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-foreground">预约挂号</h1>

        <div className="mb-8 p-6 bg-white rounded-2xl shadow-lg">
          <label htmlFor="doctor-select" className="block text-xl font-medium text-foreground mb-4">第一步: 选择医生</label>
          <select id="doctor-select" value={selectedDoctorId} onChange={(e) => { setSelectedDoctorId(e.target.value); setSelectedDate(new Date()); }} className="input-base text-lg">
            <option value="">-- 请选择一位医生 --</option>
            {doctors && Array.isArray(doctors) ? doctors.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>) : null}
          </select>
        </div>

        {selectedDoctorId && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-6 bg-white rounded-2xl shadow-lg">
              <h2 className="text-xl font-medium text-foreground mb-4">第二步: 选择日期</h2>
              <DatePicker selected={selectedDate} onChange={(date: Date) => setSelectedDate(date)} inline highlightDates={highlightedDates} minDate={new Date()} />
            </div>
            <div className="p-6 bg-white rounded-2xl shadow-lg">
              <h2 className="text-xl font-medium text-foreground mb-4">第三步: 选择时间</h2>
              {isLoading && <p>正在加载时间点...</p>}
              {error && <p className="text-error">{error}</p>}
              <div className="space-y-4">
                {schedulesForDay && Array.isArray(schedulesForDay) && schedulesForDay.length > 0 ? (
                  schedulesForDay.map(schedule => (
                    <div key={schedule.id}>
                      <h3 className="font-semibold text-lg mb-2">{schedule.room.name}</h3>
                      <div className="grid grid-cols-3 gap-2">
                        {schedule.timeSlots && Array.isArray(schedule.timeSlots) ? schedule.timeSlots.map(slot => {
                          const isBookedByMe = myAppointments.includes(`${schedule.date}-${slot.time}`);
                          const isFull = slot.booked >= slot.total;
                          return (
                            <button 
                              key={slot.time} 
                              disabled={isFull || isBookedByMe}
                              onClick={() => { setSelectedSlot({ schedule, time: slot.time }); setIsConfirmModalOpen(true); }}
                              className={`p-3 border rounded-lg text-center text-base transition-all duration-200 transform ${isBookedByMe ? 'bg-success text-white' : isFull ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white text-foreground hover:bg-gray-100 hover:scale-105'}`}>
                              {slot.time}
                              <span className="block text-sm">{isBookedByMe ? '已预约' : `余 ${slot.total - slot.booked}`}</span>
                            </button>
                          );
                        }) : (
                          <p className="text-gray-500 col-span-3">暂无可用时间段</p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500">請先選擇醫生和日期</p>
                )}
              </div>
            </div>
          </div>
        )}

        {successMessage && <div className="mt-8 p-5 bg-success text-white rounded-xl text-center text-lg">{successMessage}</div>}
      </div>

      {isConfirmModalOpen && selectedSlot && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md">
            <h2 className="text-3xl font-bold mb-6">确认预约</h2>
            <p className="text-lg mb-2">医生: {doctors.find(d => d.id === selectedDoctorId)?.name}</p>
            <p className="text-lg mb-2">日期: {selectedDate?.toLocaleDateString()}</p>
            <p className="text-lg mb-6">时间: {selectedSlot.time}</p>
            <div className="flex justify-end gap-4 mt-8">
              <button type="button" onClick={() => setIsConfirmModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">取消</button>
              <button onClick={handleBooking} className="btn btn-primary text-lg">确定</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}