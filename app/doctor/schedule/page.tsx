'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FaTrash, FaPlusCircle, FaSave, FaUserPlus } from 'react-icons/fa';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface Appointment { id: string; patient: { name: string }; status: string; }
interface TimeSlot { time: string; total: number; appointments: Appointment[]; }
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

// --- Component ---
export default function DoctorSchedulePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Core Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [highlightedDates, setHighlightedDates] = useState<Date[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  const handleCreateInitialSchedule = () => {
    const room = doctorProfile.Room.find(r => r.id === selectedRoomId);
    if (!room) return;

    const defaultTimeSlots = DEFAULT_TIMES.map(time => ({ time, total: room.bedCount, appointments: [] }));
    const newSchedule: Schedule = { id: `new-${selectedRoomId}`, date: toYYYYMMDD(selectedDate), room, timeSlots: defaultTimeSlots };
    setSchedulesForSelectedDay([newSchedule]);
  };

  // --- Initial Data Load ---
  useEffect(() => {
    if (status === 'authenticated' && session.user.role === 'DOCTOR') {
      const fetchInitialData = async () => {
        setIsLoading(true);
        try {
          const userRes = await fetch(`/api/user/${session.user.id}`);
          const userData = await userRes.json();
          if (!userData.doctorProfile) throw new Error('未找到医生资料。');
          setDoctorProfile(userData.doctorProfile);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchInitialData();
    }
  }, [status, session]);

  // --- Fetching Schedules for Calendar Highlighting ---
  useEffect(() => {
    if (!doctorProfile) return;
    const fetchMonthSchedules = async () => {
      const monthString = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/schedules?month=${monthString}`);
      const data = await res.json();
      setHighlightedDates(data.scheduledDates.map(fromYYYYMMDD));
    };
    fetchMonthSchedules();
  }, [doctorProfile, currentMonth]);

  // --- Fetching Details for Selected Date ---
  useEffect(() => {
    if (!doctorProfile) return;
    const loadDetailsForDate = async () => {
      setIsLoading(true); setError(null);
      try {
        const dateString = toYYYYMMDD(selectedDate);
        const res = await fetch(`/api/schedules/details?date=${dateString}`);
        if (!res.ok) throw new Error('获取当天排班详情失败。');
        const data: Schedule[] = await res.json();
        setSchedulesForSelectedDay(data);
      } catch (err) { setError(err instanceof Error ? err.message : '获取数据时发生错误'); } finally { setIsLoading(false); }
    };
    loadDetailsForDate();
  }, [selectedDate, doctorProfile]);

  // --- Handlers ---
  const handleSaveTimeSlot = async (scheduleId: string, timeSlot: TimeSlot) => {
    const isNew = scheduleId.startsWith('new');
    const url = isNew ? '/api/schedules' : `/api/schedules?scheduleId=${scheduleId}`;
    const method = isNew ? 'POST' : 'PUT';
    const body = {
      doctorId: doctorProfile!.id,
      date: toYYYYMMDD(selectedDate),
      roomId: isNew ? scheduleId.replace('new-', '') : schedulesForSelectedDay.find(s => s.id === scheduleId)!.room.id,
      time: timeSlot.time,
      total: timeSlot.total,
    };

    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('保存失败');
      await loadDetailsForDate(selectedDate); // Refresh data
      await fetchMonthSchedules(); // Refresh highlights
    } catch (err) { setError(err instanceof Error ? err.message : '保存时发生错误'); }
  };

  const handleDeleteTimeSlot = async (scheduleId: string) => {
    // Logic to delete a timeslot (DELETE)
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    // Logic to cancel an appointment
  };

  const handleMarkAsNoShow = async (appointmentId: string) => {
    // Logic to mark as no-show
  };

  const handleBookAppointment = async (scheduleId: string, time: string) => {
    // Logic to open a booking modal
  };

  if (isLoading) return <div className="container mx-auto p-8 text-center">正在加载数据...</div>;
  if (error) return <div className="container mx-auto p-8 text-center text-red-500">错误: {error}</div>;
  if (!doctorProfile) return <div className="container mx-auto p-8 text-center">无法加载医生信息。</div>;

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
              highlightDates={highlightedDates}
              dayClassName={date => highlightedDates.find(d => d.getTime() === date.getTime()) ? 'scheduled-date' : undefined}
            />
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-white p-8 rounded-2xl shadow-lg">
            <h2 className="text-3xl font-bold mb-6">{selectedDate.toLocaleDateString()} 的排班详情</h2>
            {schedulesForSelectedDay.length === 0 || schedulesForSelectedDay.every(s => s.timeSlots.length === 0) ? (
              <div className="text-center py-10">
                <p className="text-xl text-gray-500 mb-4">当天暂无排班</p>
                <button onClick={() => setIsTemplateModalOpen(true)} className="btn btn-primary text-lg">使用模板创建排班</button>
              </div>
            ) : (
              <div className="space-y-6">
                {schedulesForSelectedDay.map(schedule => (
                  <div key={schedule.id}>
                    <h3 className="text-2xl font-semibold mb-4">诊室: {schedule.room.name}</h3>
                    <div className="space-y-2">
                      {schedule.timeSlots.map((slot, index) => (
                        <div key={index} className="p-4 border rounded-xl bg-gray-50">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <input type="text" value={slot.time} onChange={e => handleTimeSlotChange(schedule.id, slot.time, 'time', e.target.value)} className="input-base w-28" />
                              <input type="number" value={slot.total} onChange={e => handleTimeSlotChange(schedule.id, slot.time, 'total', e.target.value)} className="input-base w-24" />
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleSaveTimeSlot(schedule.id, slot)} className="text-green-500 hover:text-green-700"><FaSave title="保存此时间点" /></button>
                              <button onClick={() => handleDeleteTimeSlot(schedule.id, slot.time)} className="text-red-500 hover:text-red-700"><FaTrash title="删除此时间点" /></button>
                              <button onClick={() => { setSelectedTimeForBooking(slot.time); setIsBookingModalOpen(true); }} className="text-blue-500 hover:text-blue-700"><FaUserPlus title="为病人预约" /></button>
                            </div>
                          </div>
                          <div className="mt-2 space-y-2">
                            {slot.appointments.map(apt => (
                              <div key={apt.id} className="flex justify-between items-center bg-gray-100 p-2 rounded-md">
                                <span>{apt.patient.name}</span>
                                <div className="flex gap-2">
                                  {new Date() > new Date(`${schedule.date}T${apt.time}`) && apt.status !== 'NO_SHOW' && (
                                    <button onClick={() => handleMarkAsNoShow(apt.id)} className="text-xs btn bg-yellow-500 text-white">标记爽约</button>
                                  )}
                                  <button onClick={() => handleCancelAppointment(apt.id)} className="text-xs btn bg-error text-white">取消预约</button>
                                </div>
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

      {isTemplateModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md">
            <h2 className="text-3xl font-bold mb-6">选择诊室以应用模板</h2>
            <div className="space-y-6">
              <div>
                <label htmlFor="room-template" className="block text-lg font-medium">诊室</label>
                <select id="room-template" value={selectedRoomId} onChange={e => setSelectedRoomId(e.target.value)} className="input-base mt-2" required>
                  {doctorProfile.Room.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-4 mt-8">
                <button type="button" onClick={() => setIsTemplateModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">取消</button>
                <button onClick={() => { handleCreateInitialSchedule(); setIsTemplateModalOpen(false); }} className="btn btn-primary text-lg">应用</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
