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
interface TimeSlot { time: string; total: number; booked: number; appointments: Appointment[]; }
interface Appointment { id: string; patient: { name: string }; status: string; }
interface Schedule {
  id: string;
  date: string;
  room: Room;
  timeSlots: TimeSlot[];
}

// --- Component ---
export default function DoctorSchedulePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Core Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]); // All schedules for the month
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Form States for Creating Schedule ---
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // --- Main Data Fetching Effect ---
  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;

    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        // Fetch doctor profile (includes rooms)
        const userRes = await fetch(`/api/user/${session.user.id}`);
        if (!userRes.ok) throw new Error('获取医生资料失败。');
        const userData = await userRes.json();
        if (!userData.doctorProfile) throw new Error('未找到医生资料。');
        setDoctorProfile(userData.doctorProfile);
        if (userData.doctorProfile.Room.length > 0 && !selectedRoomId) {
          setSelectedRoomId(userData.doctorProfile.Room[0].id);
        }

        // Fetch schedules for the current month
        const monthString = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
        const schedulesRes = await fetch(`/api/schedules?month=${monthString}`);
        if (!schedulesRes.ok) throw new Error('获取排班数据失败。');
        const scheduleData = await schedulesRes.json();
        setSchedules(scheduleData.schedules); // Assuming API returns { schedules: [] }

      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialData();
  }, [status, session, currentMonth]); // Refetch when month changes

  // --- Derived State Effect for Daily Schedules ---
  useEffect(() => {
    const dateString = toYYYYMMDD(selectedDate);
    const daily = schedules.filter(s => s.date === dateString);
    setSchedulesForSelectedDay(daily);
  }, [selectedDate, schedules]);


  // --- Helper Functions (will be moved to a separate file later) ---
  const toYYYYMMDD = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
              highlightDates={schedules.map(s => new Date(s.date))}
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
                <button className="btn btn-primary text-lg">为此日创建排班</button>
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
                            <span>{slot.booked} / {slot.total}</span>
                          </div>
                          <div className="mt-2 space-y-2">
                            {slot.appointments.map(apt => (
                              <div key={apt.id} className="flex justify-between items-center bg-gray-100 p-2 rounded-md">
                                <span>{apt.patient.name}</span>
                                {/* Add action buttons here */}
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
