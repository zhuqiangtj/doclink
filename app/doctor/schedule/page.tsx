'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface Room { id: string; name: string; bedCount: number; }
interface DoctorProfile { id: string; name: string; Room: Room[]; }
interface Appointment {
  id: string;
  date: string;
  time: string;
  room: { name: string };
  patient: { name: string };
  status: string;
  bedId: number;
}
interface Schedule { id: string; date: string; room: Room; timeSlots: TimeSlot[]; }
interface TimeSlot { time: string; total: number; booked: number; }

// --- Constants ---
const DEFAULT_TIMES = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
const statusColors: { [key: string]: string } = {
  pending: 'bg-yellow-200 text-yellow-800',
  CHECKED_IN: 'bg-blue-200 text-blue-800',
  CONFIRMED: 'bg-green-200 text-green-800',
  COMPLETED: 'bg-gray-500 text-gray-900',
  NO_SHOW: 'bg-red-200 text-red-800',
  CANCELLED: 'bg-purple-200 text-purple-800',
};
const statusTranslations: { [key: string]: string } = {
  pending: '待处理',
  CHECKED_IN: '已签到',
  CONFIRMED: '已确认',
  COMPLETED: '已完成',
  NO_SHOW: '未到诊',
  CANCELLED: '已取消',
};

// --- Helpers ---
const isToday = (dateString: string) => {
  const date = new Date(dateString);
  const today = new Date();
  return date.getFullYear() === today.getFullYear() &&
         date.getMonth() === today.getMonth() &&
         date.getDate() === today.getDate();
};

// --- Component ---
export default function DoctorDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // --- Data States ---
  const [doctorProfile, setDoctorProfile] = useState<DoctorProfile | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  // --- Form States ---
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduleRoomId, setScheduleRoomId] = useState('');

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') setError('访问被拒绝');
  }, [status, session, router]);

  useEffect(() => {
    if (status !== 'authenticated' || session.user.role !== 'DOCTOR') return;
    const fetchDoctorData = async () => {
      setIsLoading(true);
      try {
        const userRes = await fetch(`/api/user/${session.user.id}`);
        if (!userRes.ok) throw new Error('获取医生资料失败。');
        const userData = await userRes.json();
        if (!userData.doctorProfile) throw new Error('未找到医生资料。');
        setDoctorProfile(userData.doctorProfile);
        if (userData.doctorProfile.Room.length > 0) {
          setScheduleRoomId(userData.doctorProfile.Room[0].id);
        }
        
        const doctorId = userData.doctorProfile.id;
        const schedulesRes = await fetch(`/api/schedules?doctorId=${doctorId}`);
        if (!schedulesRes.ok) throw new Error('获取排班失败。');
        setSchedules(await schedulesRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    };
    fetchDoctorData();
  }, [status, session]);

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
    }
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    setError(null);
    setSuccess(null);
    if (window.confirm('您确定要取消此预约吗？')) {
      try {
        const response = await fetch(`/api/appointments?appointmentId=${appointmentId}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || '取消预约失败。');
        }
        setAppointments(prev => prev.filter(apt => apt.id !== appointmentId));
        setSuccess('预约取消成功。');
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    }
  };

  const handleCheckinConfirmation = async (appointmentId: string, action: 'CONFIRM' | 'DENY') => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '操作失败。');
      }
      const updatedAppointment = await response.json();
      setAppointments(prev => prev.map(apt => apt.id === appointmentId ? updatedAppointment : apt));
      setSuccess(`签到${action === 'CONFIRM' ? '确认' : '拒绝'}成功。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  const handleCompleteAppointment = async (appointmentId: string) => {
    const bedId = bedAssignments[appointmentId];
    if (!bedId || isNaN(parseInt(bedId))) {
      setError('请输入有效的床位号。');
      return;
    }
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/appointments/${appointmentId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bedId: parseInt(bedId) }),
      });
      if (!response.ok) throw new Error('完成就诊失败。');
      const updatedAppointment = await response.json();
      setAppointments(prev => prev.map(apt => apt.id === appointmentId ? updatedAppointment : apt));
      setSuccess('预约已标记为完成。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  // --- Filtering Logic ---

  // --- Render Logic ---
  if (status === 'loading' || isLoading || !doctorProfile) {
    return <div className="container mx-auto p-8 text-center">正在加载医生数据...</div>;
  }

  if (!session || session.user.role !== 'DOCTOR') {
    return <div className="container mx-auto p-8 text-center"><h1 className="text-2xl font-bold text-red-600">访问被拒绝</h1><p className="mt-2">{error || '您必须以医生身份登录才能查看此页面。'}</p></div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">医生工作台 ({doctorProfile.name})</h1>
      {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}
      {success && <div className="p-4 mb-6 text-lg text-white bg-success rounded-xl">{success}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Column 1: Scheduling */}
        <div className="lg:col-span-1 space-y-8">
          <div className="p-8 bg-white rounded-2xl shadow-lg">
            <h2 className="text-2xl font-semibold mb-6">创建新排班</h2>
            <form onSubmit={handleCreateSchedule} className="space-y-6">
              <div>
                <label htmlFor="date" className="block text-lg font-medium">日期</label>
                <input type="date" id="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="input-base mt-2" required/>
              </div>
              <div>
                <label htmlFor="room" className="block text-lg font-medium">诊室</label>
                <select id="room" value={scheduleRoomId} onChange={e => setScheduleRoomId(e.target.value)} className="input-base mt-2" required>
                  <option value="">-- 选择诊室 --</option>
                  {doctorProfile.Room.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
              </div>
              <button type="submit" className="w-full btn btn-primary text-lg">创建排班</button>
            </form>
          </div>

          {/* Existing Schedules */}
          <div className="p-8 bg-white rounded-2xl shadow-lg">
            <h2 className="text-2xl font-semibold mb-6">我的排班</h2>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {schedules.map(sch => (
                <div key={sch.id} className="p-4 border rounded-xl bg-gray-50">
                  <p className="font-semibold text-lg">{sch.date}</p>
                  <p className="text-base text-gray-600">诊室: {sch.room.name}</p>
                  {sch.timeSlots.map(ts => (
                    <details key={ts.time} className="text-base mt-2">
                      <summary className="cursor-pointer text-primary">{ts.time} ({ts.booked}/{ts.total} 床位)</summary>
                      <ul className="pl-4 mt-2 space-y-1">
                        {appointments.filter(apt => apt.date === sch.date && apt.time === ts.time).map(apt => (
                          <li key={apt.id} className="text-gray-700">{apt.patient.name}</li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}