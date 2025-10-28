'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FaTrash, FaPlusCircle, FaRegCalendarTimes, FaUserPlus } from 'react-icons/fa';

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
  const [schedules, setSchedules] = useState<Schedule[]>([]);
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
        setSchedules(scheduleData.scheduledDates.map((d: string) => ({ date: d, id: d, room: {} as Room, timeSlots: [] }))); // Create dummy schedule objects

      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialData();
  }, [status, session, currentMonth]);

  // --- Derived State Effect for Daily Schedules ---
  useEffect(() => {
    const dateString = toYYYYMMDD(selectedDate);
    const daily = schedules.filter(s => s.date === dateString);
    setSchedulesForSelectedDay(daily);
  }, [selectedDate, schedules]);

  // --- Handlers ---
  const handleCreateSchedule = async () => {
    // This will now be handled by handleSaveSchedule
  };

  const handleSaveSchedule = async () => {
    // Logic to save both new and edited schedules
  };

  // --- Render Logic ---
  if (isLoading) {
    return <div className="container mx-auto p-8 text-center">正在加载数据...</div>;
  }

  if (error) {
    return <div className="container mx-auto p-8 text-center text-red-500">错误: {error}</div>;
  }

  if (!doctorProfile) {
    return <div className="container mx-auto p-8 text-center">无法加载医生信息。</div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">工作台 ({doctorProfile.name})</h1>
      
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
            
            {schedulesForSelectedDay.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-xl text-gray-500 mb-4">当天暂无排班</p>
                <button onClick={handleCreateSchedule} className="btn btn-primary text-lg">为此日创建排班</button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Detailed schedule rendering will go here */}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}