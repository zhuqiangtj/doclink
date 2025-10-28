'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { FaTrash, FaPlusCircle, FaUserPlus } from 'react-icons/fa';

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
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [schedulesForSelectedDay, setSchedulesForSelectedDay] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedTimeForBooking, setSelectedTimeForBooking] = useState<string | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [searchedPatients, setSearchedPatients] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);

  // --- Data Fetching ---
  useEffect(() => {
    if (status === 'authenticated' && session.user.role === 'DOCTOR') {
      const fetchInitialData = async () => {
        setIsLoading(true);
        try {
          const userRes = await fetch(`/api/user/${session.user.id}`);
          const userData = await userRes.json();
          if (!userData.doctorProfile) throw new Error('未找到医生资料。');
          setDoctorProfile(userData.doctorProfile);
          if (userData.doctorProfile.Room.length > 0) setSelectedRoomId(userData.doctorProfile.Room[0].id);
        } catch (err) { setError(err instanceof Error ? err.message : '发生未知错误'); } finally { setIsLoading(false); }
      };
      fetchInitialData();
    }
  }, [status, session]);

  useEffect(() => {
    if (!doctorProfile) return;
    const fetchMonthSchedules = async () => {
      const monthString = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/schedules?month=${monthString}`);
      const data = await res.json();
      setSchedules(data.scheduledDates.map((d: string) => ({ date: d, id: d, room: {} as Room, timeSlots: [] })));
    };
    fetchMonthSchedules();
  }, [doctorProfile, currentMonth]);

  const loadDetailsForDate = async (date: Date) => {
    setIsLoading(true); setError(null);
    try {
      const dateString = toYYYYMMDD(date);
      const res = await fetch(`/api/schedules/details?date=${dateString}`);
      if (!res.ok) throw new Error('获取当天排班详情失败。');
      const data: Schedule[] = await res.json();
      setSchedulesForSelectedDay(data);
    } catch (err) { setError(err instanceof Error ? err.message : '获取数据时发生错误'); } finally { setIsLoading(false); }
  };

  useEffect(() => { if (doctorProfile) loadDetailsForDate(selectedDate); }, [selectedDate, doctorProfile]);

  // --- Patient Search ---
  useEffect(() => {
    if (patientSearch.length < 2) { setSearchedPatients([]); return; }
    const handler = setTimeout(() => {
      const search = async () => {
        const res = await fetch(`/api/patients?search=${patientSearch}`);
        setSearchedPatients(await res.json());
      };
      search();
    }, 500);
    return () => clearTimeout(handler);
  }, [patientSearch]);

  // --- Handlers ---
  const handleCreateSchedule = async () => {
    const room = doctorProfile!.Room.find(r => r.id === selectedRoomId);
    if (!room) { setError('请选择一个有效的诊室。'); return; }
    const timeSlots = DEFAULT_TIMES.map(time => ({ time, total: room.bedCount, appointments: [] }));
    const newSchedule: Schedule = { id: 'new-schedule', date: toYYYYMMDD(selectedDate), room, timeSlots };
    setSchedulesForSelectedDay([newSchedule]);
  };

  const handleSaveSchedule = async (schedule: Schedule) => {
    const isNew = schedule.id === 'new-schedule';
    const url = isNew ? '/api/schedules' : `/api/schedules?scheduleId=${schedule.id}`;
    const method = isNew ? 'POST' : 'PUT';
    const body = { doctorId: doctorProfile!.id, date: schedule.date, roomId: schedule.room.id, timeSlots: schedule.timeSlots.map(t => ({time: t.time, total: t.total})) };
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('保存排班失败');
      setSuccess('排班已保存！');
      if(isNew) setSchedules(prev => [...prev, schedule]);
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
  };

  const handleCancelAppointment = async (aptId: string) => {
    if (!window.confirm('确定要取消这个预约吗？')) return;
    try {
      const res = await fetch(`/api/appointments?appointmentId=${aptId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('取消预约失败');
      loadDetailsForDate(selectedDate); // Refresh details
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleMarkAsNoShow = async (aptId: string) => {
    try {
      const res = await fetch(`/api/appointments/${aptId}/no-show`, { method: 'POST' });
      if (!res.ok) throw new Error('标记爽约失败');
      loadDetailsForDate(selectedDate); // Refresh details
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败'); }
  };

  const handleBookForPatient = async () => {
    if (!selectedPatient || !selectedTimeForBooking || !schedulesForSelectedDay[0]) return;
    const schedule = schedulesForSelectedDay[0];
    try {
      await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: selectedPatient.userId, patientId: selectedPatient.id, doctorId: doctorProfile!.id, scheduleId: schedule.id, time: selectedTimeForBooking, roomId: schedule.room.id }) });
      loadDetailsForDate(selectedDate); // Refresh details
      setIsBookingModalOpen(false); setPatientSearch(''); setSearchedPatients([]); setSelectedPatient(null);
    } catch (err) { setError(err instanceof Error ? err.message : '发生未知错误'); }
  };

  // --- Render ---
  if (isLoading) return <div className="container mx-auto p-8 text-center">正在加载数据...</div>;
  if (error) return <div className="container mx-auto p-8 text-center text-red-500">错误: {error}</div>;
  if (!doctorProfile) return <div className="container mx-auto p-8 text-center">无法加载医生信息。</div>;

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">工作台 ({doctorProfile.name})</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1"><div className="bg-white p-4 rounded-2xl shadow-lg"><DatePicker selected={selectedDate} onChange={(date: Date) => setSelectedDate(date)} onMonthChange={(date: Date) => setCurrentMonth(date)} inline highlightDates={schedules.map(s => fromYYYYMMDD(s.date))} dayClassName={date => schedules.find(s => s.date === toYYYYMMDD(date)) ? 'scheduled-date' : undefined}/></div></div>
        <div className="lg:col-span-2"><div className="bg-white p-8 rounded-2xl shadow-lg"><h2 className="text-3xl font-bold mb-6">{selectedDate.toLocaleDateString()} 的排班详情</h2>{schedulesForSelectedDay.length === 0 ? <div className="text-center py-10"><p className="text-xl text-gray-500 mb-4">当天暂无排班</p><div className="flex items-end gap-4 max-w-sm mx-auto"><div className="flex-grow"><label htmlFor="room" className="block text-lg font-medium text-left">选择诊室</label><select id="room" value={selectedRoomId} onChange={e => setSelectedRoomId(e.target.value)} className="input-base mt-2" required>{doctorProfile.Room.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></div><button onClick={handleCreateSchedule} className="btn btn-primary text-lg">创建排班</button></div></div> : <div className="space-y-6">{schedulesForSelectedDay.map(schedule => (<div key={schedule.id}><h3 className="text-2xl font-semibold mb-4">诊室: {schedule.room.name}</h3><div className="space-y-2">{schedule.timeSlots.map((slot, index) => (<div key={index} className="p-4 border rounded-xl bg-gray-50"><div className="flex justify-between items-center mb-3"><span className="font-bold text-lg">{slot.time}</span><span className="font-semibold">{slot.appointments.length} / {slot.total}</span><div className="flex items-center gap-2"><button onClick={() => { setSelectedTimeForBooking(slot.time); setIsBookingModalOpen(true); }} className="text-green-500 hover:text-green-700"><FaUserPlus title="为病人预约" /></button><button onClick={() => handleSaveSchedule(schedule)} className="text-red-500 hover:text-red-700"><FaTrash title="删除时间点" /></button></div></div><div className="mt-2 space-y-2">{slot.appointments.map(apt => (<div key={apt.id} className="flex justify-between items-center bg-white p-2 rounded-md shadow-sm"><span>{apt.patient.name}</span>{new Date() > new Date(`${schedule.date}T${apt.time}`) && apt.status !== 'NO_SHOW' ? (<button onClick={() => handleMarkAsNoShow(apt.id)} className="btn btn-xs bg-yellow-500 text-white">标记爽约</button>) : (<button onClick={() => handleCancelAppointment(apt.id)} className="btn btn-xs bg-error text-white">取消预约</button>)}</div>))}</div></div>))}</div><div className="flex justify-end mt-6"><button onClick={() => handleSaveSchedule(schedule)} className="btn btn-primary text-lg">保存对此诊室的修改</button></div></div>))}</div>}</div></div>
      </div>
      {isBookingModalOpen && <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"><div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-lg"><h2 className="text-3xl font-bold mb-6">为 {selectedTimeForBooking} 时间点预约</h2><div className="space-y-4"><div><label htmlFor="patientSearch" className="block text-lg font-medium">搜索病人</label><input id="patientSearch" type="text" value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="按姓名或用户名搜索..." className="input-base mt-2" /></div>{searchedPatients.length > 0 && <ul className="border rounded-xl max-h-48 overflow-y-auto">{searchedPatients.map(p => (<li key={p.id} onClick={() => { setSelectedPatient(p); setPatientSearch(p.name); setSearchedPatients([]); }} className="p-4 hover:bg-gray-100 cursor-pointer">{p.name} ({p.username})</li>))}</ul>}{selectedPatient && <p className="text-xl text-success">已选择: {selectedPatient.name}</p>}</div><div className="flex justify-end gap-4 mt-8"><button type="button" onClick={() => setIsBookingModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">取消</button><button onClick={handleBookForPatient} disabled={!selectedPatient} className="btn btn-primary text-lg disabled:bg-gray-400">确认预约</button></div></div></div>}
    </div>
  );
}
