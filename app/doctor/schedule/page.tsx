'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FaTrash, FaPlusCircle } from 'react-icons/fa';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface Appointment { id: string; patient: { name: string }; status: string; time: string; }
interface TimeSlot { time: string; total: number; appointments: Appointment[]; }
interface Schedule {
  id: string;
  date: string;
  room: Room;
  timeSlots: TimeSlot[];
}

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
  const router = useRouter();

  // --- Core Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]); // Overview for the month
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // --- Form States for Creating/Editing Schedule ---
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [timeSlots, setTimeSlots] = useState<Partial<TimeSlot>[]>([]);

  // --- Main Data Fetching Effect ---
  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;

    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        const userRes = await fetch(`/api/user/${session.user.id}`);
        if (!userRes.ok) throw new Error('获取医生资料失败。');
        const userData = await userRes.json();
        if (!userData.doctorProfile) throw new Error('未找到医生资料。');
        setDoctorProfile(userData.doctorProfile);
        if (userData.doctorProfile.Room.length > 0 && !selectedRoomId) {
          setSelectedRoomId(userData.doctorProfile.Room[0].id);
        }

        const monthString = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
        const schedulesRes = await fetch(`/api/schedules?month=${monthString}`);
        if (!schedulesRes.ok) throw new Error('获取排班数据失败。');
        const scheduleData = await schedulesRes.json();
        setSchedules(scheduleData.scheduledDates.map((d: string) => ({ date: d, id: d, room: {} as Room, timeSlots: [] })));

      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialData();
  }, [status, session, currentMonth]);

  // --- Effect to load details when a date is selected ---
  useEffect(() => {
    const loadDetailsForDate = async () => {
      setError(null);
      setIsLoading(true);
      try {
        const dateString = toYYYYMMDD(selectedDate);
        const res = await fetch(`/api/schedules/details?date=${dateString}`);
        if (!res.ok) throw new Error('获取当天排班详情失败。');
        const data: Schedule[] = await res.json();
        setSchedulesForSelectedDay(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取数据时发生错误');
      } finally {
        setIsLoading(false);
      }
    };
    loadDetailsForDate();
  }, [selectedDate]);

  // --- Handlers ---
  const handleCreateSchedule = () => {
    const room = doctorProfile!.Room.find(r => r.id === selectedRoomId);
    if (!room) {
      setError('请先选择一个有效的诊室。');
      return;
    }
    const defaultTimeSlots = DEFAULT_TIMES.map(time => ({ time, total: room.bedCount, appointments: [] }));
    const newSchedule: Schedule = {
      id: 'new-schedule', // Temporary ID
      date: toYYYYMMDD(selectedDate),
      room: room,
      timeSlots: defaultTimeSlots,
    };
    setSchedulesForSelectedDay([newSchedule]);
  };

  const handleSaveSchedule = async () => {
    // ... (Implementation will be added in the next step)
  };

  // --- Render Logic ---
  if (isLoading) {
    return <div className="container mx-auto p-8 text-center">正在加载数据...</div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">工作台 ({doctorProfile?.name})</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="bg-white p-4 rounded-2xl shadow-lg">
            <DatePicker
              selected={selectedDate}
              onChange={(date: Date) => setSelectedDate(date)}
              onMonthChange={(date: Date) => setCurrentMonth(date)}
              inline
              highlightDates={schedules.map(s => fromYYYYMMDD(s.date))}
              dayClassName={date => schedules.find(s => s.date === toYYYYMMDD(date)) ? 'scheduled-date' : undefined}
            />
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white p-8 rounded-2xl shadow-lg">
            <h2 className="text-3xl font-bold mb-6">{selectedDate.toLocaleDateString()} 的排班详情</h2>
            {error && <p className="text-error mb-4">{error}</p>}
            
            {schedulesForSelectedDay.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-xl text-gray-500 mb-4">当天暂无排班</p>
                <div className="flex items-end gap-4 max-w-sm mx-auto">
                  <div className="flex-grow">
                    <label htmlFor="room" className="block text-lg font-medium text-left">选择诊室</label>
                    <select id="room" value={selectedRoomId} onChange={e => setSelectedRoomId(e.target.value)} className="input-base mt-2" required>
                      {doctorProfile?.Room.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                    </select>
                  </div>
                  <button onClick={handleCreateSchedule} className="btn btn-primary text-lg">创建排班</button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {schedulesForSelectedDay.map(schedule => (
                  <div key={schedule.id}>
                    <h3 className="text-2xl font-semibold mb-4">诊室: {schedule.room.name}</h3>
                    <div className="space-y-4">
                      {schedule.timeSlots.map((slot, index) => (
                        <div key={index} className="p-4 border rounded-xl">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-lg">{slot.time}</span>
                            <span>{slot.appointments.length} / {slot.total}</span>
                          </div>
                          <div className="mt-2 space-y-2">
                            {slot.appointments.map(apt => (
                              <div key={apt.id} className="flex justify-between items-center bg-gray-100 p-2 rounded-md">
                                <span>{apt.patient.name}</span>
                                {/* Action buttons will be added here */}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}