'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface Appointment {
  id: string;
  time: string;
  patient: { name: string };
  scheduleId: string;
}
interface Schedule { id: string; date: string; room: Room; timeSlots: TimeSlot[]; }
interface TimeSlot { time: string; total: number; booked: number; }

// --- Constants ---
const DEFAULT_TIMES = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

// --- Component ---
export default function DoctorSchedulePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  // --- Form States ---


  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [highlightedDates, setHighlightedDates] = useState<Date[]>([]);

  // --- Modal States ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [schedulesForSelectedDate, setSchedulesForSelectedDate] = useState<Schedule[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') setError('访问被拒绝');
  }, [status, session, router]);

  useEffect(() => {
    const dates = schedules.map(s => new Date(s.date));
    setHighlightedDates(dates);
  }, [schedules]);

  // --- Handlers ---
  const handleCreateSchedule = async (e: FormEvent) => {
    e.preventDefault();
    if (!scheduleDate || !scheduleRoomId || !doctorProfile) {
      setError('请选择日期和诊室。');
      return;
    }
    setError(null);
    setSuccess(null);

    const room = doctorProfile.Room.find(r => r.id === scheduleRoomId);
    if (!room) return;

    const timeSlots: TimeSlot[] = DEFAULT_TIMES.map(time => ({
      time,
      total: room.bedCount,
      booked: 0,
    }));

    try {
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: doctorProfile.id,
          roomId: scheduleRoomId,
          date: scheduleDate,
          timeSlots,
        }),
      });
      if (!response.ok) throw new Error('创建排班失败。');
      
      const newSchedule = await response.json();
      setSchedules(prev => [...prev, { ...newSchedule, room }]);
      setSuccess('排班创建成功！');
          } catch (err) {
            setError(err instanceof Error ? err.message : '发生未知错误');
          } finally {
            setIsLoading(false);
          }  };

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    const existingSchedules = schedules.filter(s => new Date(s.date).toDateString() === date.toDateString());
    setSchedulesForSelectedDate(existingSchedules);
    setIsEditing(existingSchedules.length > 0);
    setIsModalOpen(true);
  };

  // --- Render Logic ---
  if (status === 'loading' || isLoading || !doctorProfile) {
    return <div className="container mx-auto p-8 text-center">正在加载医生数据...</div>;
  }

  if (!session || session.user.role !== 'DOCTOR') {
    return <div className="container mx-auto p-8 text-center"><h1 className="text-2xl font-bold text-red-600">访问被拒绝</h1><p className="mt-2">{error || '您必须以医生身份登录才能查看此页面。'}</p></div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">排班日历 ({doctorProfile.name})</h1>
      {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}
      {success && <div className="p-4 mb-6 text-lg text-white bg-success rounded-xl">{success}</div>}

      <div className="bg-white p-8 rounded-2xl shadow-lg">
        <DatePicker
          selected={selectedDate}
          onChange={handleDateClick}
          inline
          highlightDates={highlightedDates}
          className="w-full"
        />
      </div>

      {isModalOpen && selectedDate && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-2xl">
            <h2 className="text-3xl font-bold mb-6">{isEditing ? '编辑' : '创建'} {selectedDate.toLocaleDateString()} 的排班</h2>
            
            {/* Form for creating a new schedule */}
            {!isEditing && (
              <form onSubmit={handleCreateSchedule} className="space-y-6 mb-8">
                <div>
                  <label htmlFor="room" className="block text-lg font-medium">选择诊室</label>
                  <select id="room" value={scheduleRoomId} onChange={e => setScheduleRoomId(e.target.value)} className="input-base mt-2" required>
                    <option value="">-- 选择一个诊室 --</option>
                    {doctorProfile.Room.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary text-lg">创建</button>
              </form>
            )}

            {/* List of schedules for the selected date */}
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {schedulesForSelectedDate.map(sch => (
                <div key={sch.id} className="p-4 border rounded-xl bg-gray-50">
                  <p className="font-semibold text-lg">诊室: {sch.room.name}</p>
                  {sch.timeSlots.map(ts => (
                    <details key={ts.time} className="text-base mt-2">
                      <summary className="cursor-pointer text-primary">{ts.time} ({ts.booked}/{ts.total} 床位)</summary>
                      <ul className="pl-4 mt-2 space-y-1">
                        {appointments.filter(apt => apt.scheduleId === sch.id && apt.time === ts.time).map(apt => (
                          <li key={apt.id} className="text-gray-700">{apt.patient.name}</li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-4 mt-8">
              <button type="button" onClick={() => setIsModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}