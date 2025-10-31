'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FaTrash, FaSave, FaUserPlus, FaPlusCircle } from 'react-icons/fa';

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Modal & Form States ---
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedTimeForBooking, setSelectedTimeForBooking] = useState<string | null>(null);
  const [selectedRoomIdForTemplate, setSelectedRoomIdForTemplate] = useState<string>('');
  const [patientSearch, setPatientSearch] = useState('');
  const [searchedPatients, setSearchedPatients] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);

  // --- Data Fetching ---
  const fetchAllDataForDate = useCallback(async (date: Date) => {
    if (!session?.user?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const dateString = toYYYYMMDD(date);
      const monthString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      const [profileRes, detailsRes, highlightsRes] = await Promise.all([
        !doctorProfile ? fetch(`/api/user/${session.user.id}`) : Promise.resolve(null),
        fetch(`/api/schedules/details?date=${dateString}`),
        fetch(`/api/schedules?month=${monthString}`)
      ]);

      if (profileRes) {
        if (!profileRes.ok) throw new Error('获取医生资料失败。');
        const userData = await profileRes.json();
        if (!userData.doctorProfile) throw new Error('未找到医生资料。');
        setDoctorProfile(userData.doctorProfile);
        if (userData.doctorProfile.Room.length > 0 && !selectedRoomIdForTemplate) {
          setSelectedRoomIdForTemplate(userData.doctorProfile.Room[0].id);
        }
      }

      if (!detailsRes.ok) throw new Error('获取当天排班详情失败。');
      const detailsData = await detailsRes.json();
      setSchedulesForSelectedDay(detailsData);

      if (!highlightsRes.ok) throw new Error('获取高亮日期失败。');
      const highlightsData = await highlightsRes.json();
      setHighlightedDates(highlightsData.scheduledDates.map(fromYYYYMMDD));

    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据时发生错误');
    } finally {
      setIsLoading(false);
    }
  }, [session, doctorProfile]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchAllDataForDate(selectedDate);
    }
  }, [status, selectedDate, fetchAllDataForDate]);

  // --- Handlers ---
  const handleApplyTemplate = async () => {
    const room = doctorProfile!.Room.find(r => r.id === selectedRoomIdForTemplate);
    if (!room) return;
    
    setIsLoading(true);
    try {
      for (const time of DEFAULT_TIMES) {
        await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: toYYYYMMDD(selectedDate), roomId: room.id, time, total: room.bedCount }),
        });
      }
      setSuccess('模板应用成功！');
      await fetchAllDataForDate(selectedDate);
    } catch (err) {
      setError('应用模板时出错。');
    } finally {
      setIsLoading(false);
      setIsTemplateModalOpen(false);
    }
  };

  // ... other handlers ...

  // --- Render ---
  if (isLoading && !doctorProfile) return <div className="container mx-auto p-8 text-center">正在加载数据...</div>;
  if (error) return <div className="container mx-auto p-8 text-center text-red-500">错误: {error}</div>;
  if (!doctorProfile) return <div className="container mx-auto p-8 text-center">无法加载医生信息。</div>;

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">工作台 ({doctorProfile.name})</h1>
      {success && <div className="p-4 mb-6 text-lg text-white bg-green-500 rounded-xl">{success}</div>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1"><div className="bg-white p-4 rounded-2xl shadow-lg"><DatePicker selected={selectedDate} onChange={(date: Date) => setSelectedDate(date)} onMonthChange={(date: Date) => setCurrentMonth(date)} inline highlightDates={highlightedDates} dayClassName={date => highlightedDates.find(d => d.getTime() === date.getTime()) ? 'scheduled-date' : undefined}/></div></div>
        <div className="lg:col-span-2"><div className="bg-white p-8 rounded-2xl shadow-lg">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-3xl font-bold">{selectedDate.toLocaleDateString()}</h2>
            <button onClick={() => setIsTemplateModalOpen(true)} className="btn btn-secondary text-lg">使用模板填充</button>
          </div>
          {isLoading ? <p>正在加载详情...</p> : schedulesForSelectedDay.length === 0 ? (
            <div className="text-center py-10"><p className="text-xl text-gray-500">当天暂无排班</p></div>
          ) : (
            <div className="space-y-6">
              {schedulesForSelectedDay.map(schedule => (
                <div key={schedule.id}>
                  <h3 className="text-2xl font-semibold mb-4">诊室: {schedule.room.name}</h3>
                  <div className="space-y-2">
                    {schedule.timeSlots.map((slot, index) => (
                      <div key={index} className="p-4 border rounded-xl bg-gray-50">
                        {/* Fully interactive timeslot row will be rendered here */}
                        <p>{slot.time} - {slot.appointments.length}/{slot.total}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div></div>
      </div>
      {isTemplateModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-md">
            <h2 className="text-3xl font-bold mb-6">选择诊室以应用模板</h2>
            <div className="space-y-6">
              <div>
                <label htmlFor="room-template" className="block text-lg font-medium">诊室</label>
                <select id="room-template" value={selectedRoomIdForTemplate} onChange={e => setSelectedRoomIdForTemplate(e.target.value)} className="input-base mt-2" required>
                  {doctorProfile.Room.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-4 mt-8">
                <button type="button" onClick={() => setIsTemplateModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">取消</button>
                <button onClick={handleApplyTemplate} className="btn btn-primary text-lg">应用</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Booking Modal will be added here */}
    </div>
  );
}
