'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from 'next-auth';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

// --- Interfaces ---
interface Doctor {
  id: string;
  name: string;
}

interface Schedule {
  id: string;
  date: string;
  room: { id: string; name: string };
  timeSlots: { time: string; total: number; booked: number }[];
}

// --- Component ---
export default function HomePage({ session }: { session: Session | null }) {
  const router = useRouter();
  const status = session ? 'authenticated' : 'unauthenticated';

  // Data states
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [patientId, setPatientId] = useState<string | null>(null);

  // UI states
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<{ scheduleId: string; time: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
      return;
    }
    if (session?.user?.role !== 'PATIENT') {
      // Redirect non-patients to their respective dashboards or a default page
      if (session?.user?.role === 'ADMIN') {
        router.push('/admin/dashboard');
      } else if (session?.user?.role === 'DOCTOR') {
        router.push('/doctor/schedule');
      } else {
        // Handle other roles or unexpected scenarios
        router.push('/');
      }
    }
  }, [session, status, router]);

  // Fetch doctors and patient profile on initial load after session is verified
  useEffect(() => {
    if (status !== 'authenticated') return;

    const fetchData = async () => {
      try {
        const res = await fetch('/api/doctors');
        if (!res.ok) throw new Error("获取医生列表失败。");
        const data = await res.json();
        setDoctors(data);

        const userRes = await fetch(`/api/user/${session.user.id}`);
        if (!userRes.ok) throw new Error("获取用户资料失败。");
        const userData = await userRes.json();
        if (userData.patientProfile) {
          setPatientId(userData.patientProfile.id);
        } else {
          setError("未找到该用户的患者资料。");
        }

      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    };
    fetchData();
  }, [status, session]);

  // Fetch schedules when a doctor and date are selected
  useEffect(() => {
    if (!selectedDoctorId || !selectedDate) {
      setSchedules([]);
      return;
    }

    const fetchSchedules = async () => {
      setIsLoading(true);
      setError(null);
      setSchedules([]);
      setSelectedRoomId('');
      setSelectedSlot(null);
      try {
        const dateString = selectedDate.toISOString().split('T')[0];
        const res = await fetch(`/api/public/schedules?doctorId=${selectedDoctorId}&date=${dateString}`);
        if (!res.ok) throw new Error("获取排班失败。");
        const data = await res.json();
        setSchedules(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSchedules();
  }, [selectedDoctorId, selectedDate]);

  const handleBooking = async () => {
    if (!selectedSlot || !selectedDoctorId || !session?.user?.id || !patientId || !selectedRoomId) {
      setError("请完成所有步骤，并确保您已正确登录。");
      return;
    }
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
          scheduleId: selectedSlot.scheduleId,
          time: selectedSlot.time,
          roomId: selectedRoomId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "预约失败。");
      }

      setSuccessMessage(`成功预约 ${selectedSlot.time} 的号！`);
      setSelectedSlot(null);
      // Refresh schedules to show updated availability
      const dateString = selectedDate!.toISOString().split('T')[0];
      const schedulesRes = await fetch(`/api/public/schedules?doctorId=${selectedDoctorId}&date=${dateString}`);
      const data = await schedulesRes.json();
      setSchedules(data);

    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  if (!session) {
    return <main className="container mx-auto p-8 text-center">正在跳转到登录页面...</main>;
  }

  return (
    <main className="container mx-auto p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-foreground">预约挂号</h1>

        {/* Step 1: Select Doctor */}
        <div className="mb-8 p-6 bg-white rounded-2xl shadow-lg">
          <label htmlFor="doctor-select" className="block text-xl font-medium text-foreground mb-4">
            第一步: 选择医生
          </label>
          <select
            id="doctor-select"
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            className="input-base text-lg"
          >
            <option value="">-- 请选择一位医生 --</option>
            {doctors.map((doc) => (
              <option key={doc.id} value={doc.id}>{doc.name}</option>
            ))}
          </select>
        </div>

        {/* Step 2: Select Date */}
        {selectedDoctorId && (
          <div className="mb-8 p-6 bg-white rounded-2xl shadow-lg">
            <label htmlFor="date-picker" className="block text-xl font-medium text-foreground mb-4">
              第二步: 选择日期
            </label>
            <DatePicker
              id="date-picker"
              selected={selectedDate}
              onChange={(date: Date) => setSelectedDate(date)}
              minDate={new Date()}
              dateFormat="yyyy-MM-dd"
              className="input-base text-lg"
              placeholderText="点击选择日期"
            />
          </div>
        )}

        {/* Step 3: Select Room */}
        {selectedDoctorId && selectedDate && (
          <div className="mb-8 p-6 bg-white rounded-2xl shadow-lg">
            <h2 className="text-xl font-medium text-foreground mb-4">
              第三步: 选择诊室
            </h2>
            {isLoading && <p className="text-center text-lg">正在加载诊室...</p>}
            {error && <p className="p-4 text-lg text-error bg-red-100 rounded-lg">{error}</p>}
            <div className="space-y-4">
              {schedules.map((schedule) => (
                <div key={schedule.room.id} 
                     onClick={() => setSelectedRoomId(schedule.room.id)}
                     className={`p-5 border rounded-xl cursor-pointer transition-all duration-200 ${selectedRoomId === schedule.room.id ? 'bg-primary text-white shadow-lg' : 'bg-gray-50 hover:bg-gray-100'}`}>
                  <h3 className="font-semibold text-xl">{schedule.room.name}</h3>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Select Time Slot */}
        {selectedRoomId && (
          <div className="mb-8 p-6 bg-white rounded-2xl shadow-lg">
            <h2 className="text-xl font-medium text-foreground mb-4">
              第四步: 选择时间
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {schedules.find(s => s.room.id === selectedRoomId)?.timeSlots.map((slot) => (
                <button
                  key={slot.time}
                  onClick={() => setSelectedSlot({ scheduleId: schedules.find(s => s.room.id === selectedRoomId)!.id, time: slot.time })}
                  disabled={slot.booked >= slot.total}
                  className={`p-3 border rounded-lg text-center text-base transition-all duration-200 transform
                    ${selectedSlot?.time === slot.time
                      ? 'bg-secondary text-white scale-105 shadow-lg'
                      : 'bg-white text-foreground hover:bg-gray-100 hover:scale-105'
                    }
                    ${slot.booked >= slot.total ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : ''}
                  `}
                >
                  {slot.time}
                  <span className="block text-sm">({slot.booked}/{slot.total})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 5: Confirm and Book */}
        {selectedSlot && (
          <div className="mt-8 p-6 bg-white rounded-2xl shadow-lg text-center">
             <p className="font-semibold text-xl mb-4">
              您已选择: {selectedSlot.time}
            </p>
            <button
              onClick={handleBooking}
              className="w-full max-w-sm btn btn-accent text-xl"
            >
              确认预约
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mt-8 p-5 bg-success text-white rounded-xl text-center text-lg">
            {successMessage}
          </div>
        )}
      </div>
    </main>
  );
}
