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

  const handleTimeSlotChange = (scheduleId: string, index: number, field: 'time' | 'total' | 'roomId', value: string) => {
    const updatedSchedules = schedulesForSelectedDay.map(sch => {
      if (sch.id === scheduleId) {
        const updatedTimeSlots = [...sch.timeSlots];
        const newSlot = { ...updatedTimeSlots[index], [field]: field === 'total' ? Number(value) : value };
        updatedTimeSlots[index] = newSlot;
        return { ...sch, timeSlots: updatedTimeSlots, ...(field === 'roomId' && { room: { ...sch.room, id: value } }) };
      }
      return sch;
    });
    setSchedulesForSelectedDay(updatedSchedules);
  };

  const handleSaveTimeSlot = async (schedule: Schedule, timeSlot: TimeSlot, originalTime: string) => {
    try {
      const res = await fetch(`/api/schedules?scheduleId=${schedule.id}&time=${originalTime}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          time: timeSlot.time, 
          total: timeSlot.total,
          roomId: schedule.room.id,
        }),
      });
      if (!res.ok) throw new Error('保存失败');
      setSuccess('保存成功!');
      await fetchAllDataForDate(selectedDate);
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
  };

  const handleDeleteTimeSlot = async (scheduleId: string, time: string) => {
    if (window.confirm('您确定要删除这个时间点吗？')) {
      try {
        const res = await fetch(`/api/schedules?scheduleId=${scheduleId}&time=${time}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('删除失败');
        setSuccess('删除成功!');
        await fetchAllDataForDate(selectedDate);
      } catch (err) { setError(err instanceof Error ? err.message : '删除失败'); }
    }
  };

  const handleAddNewTimeSlot = async () => {
    if (!doctorProfile || doctorProfile.Room.length === 0) return;
    const newTime = '17:00';
    const room = doctorProfile.Room[0];
    try {
      await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: toYYYYMMDD(selectedDate), roomId: room.id, time: newTime, total: room.bedCount }),
      });
      setSuccess('新时间点已添加!');
      await fetchAllDataForDate(selectedDate);
    } catch (err) {
      setError('添加新时间点失败。');
    }
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    if (window.confirm('您确定要为病人取消这个预约吗？')) {
      try {
        const res = await fetch(`/api/appointments?appointmentId=${appointmentId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('取消失败');
        setSuccess('预约已取消!');
        await fetchAllDataForDate(selectedDate);
      } catch (err) { setError(err instanceof Error ? err.message : '取消失败'); }
    }
  };

  const handleMarkAsNoShow = async (appointmentId: string) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/no-show`, { method: 'POST' });
      if (!res.ok) throw new Error('标记失败');
      setSuccess('已标记为爽约!');
      await fetchAllDataForDate(selectedDate);
    } catch (err) { setError(err instanceof Error ? err.message : '标记失败'); }
  };

  const handlePatientSearch = async () => {
    if (patientSearch.length < 2) {
      setSearchedPatients([]);
      return;
    }
    const res = await fetch(`/api/patients?search=${patientSearch}`);
    setSearchedPatients(await res.json());
  };

  const handleBookAppointment = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !selectedTimeForBooking || !doctorProfile) {
      setError('请先搜索并选择一个病人。');
      return;
    }

    const scheduleForBooking = schedulesForSelectedDay.find(s => s.timeSlots.some(ts => ts.time === selectedTimeForBooking));
    if (!scheduleForBooking) {
      setError('找不到对应的排班记录。');
      return;
    }

    const body = {
      userId: selectedPatient.userId,
      patientId: selectedPatient.id,
      doctorId: doctorProfile.id,
      scheduleId: scheduleForBooking.id,
      time: selectedTimeForBooking,
      roomId: scheduleForBooking.room.id,
    };

    try {
      const res = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('为病人预约失败');
      
      setSuccess('预约成功!');
      await fetchAllDataForDate(selectedDate);
      setIsBookingModalOpen(false);
      setPatientSearch('');
      setSelectedPatient(null);

    } catch (err) {
      setError(err instanceof Error ? err.message : '预约失败');
    }
  };

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
            <div>
              <button onClick={handleAddNewTimeSlot} className="btn btn-accent text-lg mr-4">+ 增加时间点</button>
              <button onClick={() => setIsTemplateModalOpen(true)} className="btn btn-secondary text-lg">使用模板填充</button>
            </div>
          </div>
          {isLoading ? <p>正在加载详情...</p> : schedulesForSelectedDay.length === 0 ? (
            <div className="text-center py-10"><p className="text-xl text-gray-500">当天暂无排班</p></div>
          ) : (
            <div className="space-y-6">
              {schedulesForSelectedDay.map(schedule => (
                <div key={schedule.id}>
                  <div className="space-y-2">
                    {schedule.timeSlots.map((slot, index) => (
                      <div key={index} className="p-4 border rounded-xl bg-gray-50">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <select value={schedule.room.id} onChange={e => handleTimeSlotChange(schedule.id, index, 'roomId', e.target.value)} className="input-base">
                              {doctorProfile.Room.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                            <input type="text" value={slot.time} onChange={e => handleTimeSlotChange(schedule.id, index, 'time', e.target.value)} className="input-base w-28" />
                            <input type="number" value={slot.total} onChange={e => handleTimeSlotChange(schedule.id, index, 'total', e.target.value)} className="input-base w-24" />
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleSaveTimeSlot(schedule, slot, slot.time)} className="text-green-500 hover:text-green-700"><FaSave title="保存此时间点" /></button>
                            <button onClick={() => handleDeleteTimeSlot(schedule.id, slot.time)} className="text-red-500 hover:text-red-700"><FaTrash title="删除此时间点" /></button>
                            <button onClick={() => { setSelectedTimeForBooking(slot.time); setIsBookingModalOpen(true); }} className="text-blue-500 hover:text-blue-700"><FaUserPlus title="为病人预约" /></button>
                          </div>
                        </div>
                        <div className="mt-4 space-y-2">
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
      {isBookingModalOpen && selectedTimeForBooking && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-lg">
            <h2 className="text-3xl font-bold mb-6">为 {selectedTimeForBooking} 时间点预约</h2>
            <form onSubmit={handleBookAppointment} className="space-y-6">
              <div>
                <label htmlFor="patient-search" className="block text-lg font-medium">搜索病人</label>
                <div className="flex gap-2 mt-2">
                  <input id="patient-search" type="text" value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="按姓名或用户名搜索..." className="input-base flex-grow text-lg" />
                  <button type="button" onClick={handlePatientSearch} className="btn btn-secondary text-lg">搜索</button>
                </div>
                {searchedPatients.length > 0 && (
                  <ul className="mt-2 border rounded-xl max-h-40 overflow-y-auto bg-gray-50">
                    {searchedPatients.map(p => (
                      <li key={p.id} onClick={() => { setSelectedPatient(p); setSearchedPatients([]); setPatientSearch(p.name); }} className="p-4 hover:bg-gray-100 cursor-pointer text-lg">
                        {p.name} ({p.username})
                      </li>
                    ))}
                  </ul>
                )}
                {selectedPatient && <p className="mt-2 text-xl text-success">已选择: {selectedPatient.name}</p>}
              </div>
              <div className="flex justify-end gap-4 mt-8">
                <button type="button" onClick={() => setIsBookingModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">取消</button>
                <button type="submit" className="btn btn-primary text-lg" disabled={!selectedPatient}>确认预约</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}