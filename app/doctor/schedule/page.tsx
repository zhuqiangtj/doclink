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
  scheduleId: string;
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
  pending: '待确认',
  CHECKED_IN: '已签到',
  CONFIRMED: '待就诊',
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
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  
  // --- Form States ---
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduleRoomId, setScheduleRoomId] = useState('');

  // --- UI States ---
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('checked_in');

  // --- Modal States ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [assignedBedId, setAssignedBedId] = useState('');

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') setError('访问被拒绝');
  }, [status, session, router]);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;

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
        const [schedulesRes, appointmentsRes] = await Promise.all([
          fetch(`/api/schedules?doctorId=${doctorId}`),
          fetch(`/api/appointments?doctorId=${doctorId}`)
        ]);
        if (!schedulesRes.ok) throw new Error('获取排班失败。');
        if (!appointmentsRes.ok) throw new Error('获取预约失败。');
        setSchedules(await schedulesRes.json());
        setAppointments(await appointmentsRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };
    fetchDoctorData();
  }, [status, session]);

  // --- Handlers ---
  const openConfirmationModal = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setAssignedBedId('');
    setIsModalOpen(true);
  };

  const handleConfirmAndAssignBed = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedAppointment || !assignedBedId) {
      setError('请输入床位号。');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/appointments/${selectedAppointment.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CONFIRM', bedId: parseInt(assignedBedId) }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '操作失败。');
      }

      const updatedAppointment = await response.json();
      setAppointments(prev => prev.map(apt => apt.id === selectedAppointment.id ? updatedAppointment : apt));
      setSuccess(`已为 ${selectedAppointment.patient.name} 确认并分配床位。`);
      setIsModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  // --- Filtering Logic ---
  const checkedInAppointments = appointments.filter(apt => isToday(apt.date) && apt.status === 'CHECKED_IN');
  const confirmedTodayAppointments = appointments.filter(apt => isToday(apt.date) && apt.status === 'CONFIRMED');
  const futureAppointments = appointments.filter(apt => new Date(apt.date) > new Date() && apt.status === 'pending');
  const historyAppointments = appointments.filter(apt => ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(apt.status));

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

      <div className="p-8 bg-white rounded-2xl shadow-lg">
        <h2 className="text-2xl font-semibold mb-6">预约管理</h2>
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button onClick={() => setActiveTab('checked_in')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'checked_in' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>等待确认</button>
            <button onClick={() => setActiveTab('confirmed')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'confirmed' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>今日待就诊</button>
            <button onClick={() => setActiveTab('future')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'future' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>未来预约</button>
            <button onClick={() => setActiveTab('history')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>历史记录</button>
          </nav>
        </div>

        <div className="mt-6 space-y-4 max-h-96 overflow-y-auto">
          {activeTab === 'checked_in' && (checkedInAppointments.length > 0 ? checkedInAppointments.map(apt => (
            <div key={apt.id} className="p-4 border rounded-xl bg-blue-50 text-base">
              <p className="font-semibold text-lg">{apt.patient.name} - {apt.time}</p>
              <div className="mt-4 pt-4 border-t flex items-center gap-4">
                <button onClick={() => openConfirmationModal(apt)} className="btn btn-primary text-base">确认并分配床位</button>
              </div>
            </div>
          )) : <p>没有已签到的病人。</p>)}
          
          {activeTab === 'confirmed' && (confirmedTodayAppointments.length > 0 ? confirmedTodayAppointments.map(apt => (
            <div key={apt.id} className="p-4 border rounded-xl bg-green-50 text-base">
              <p className="font-semibold text-lg">{apt.patient.name} - {apt.time} (床位: {apt.bedId})</p>
            </div>
          )) : <p>没有等待就诊的病人。</p>)}

          {activeTab === 'future' && (futureAppointments.length > 0 ? futureAppointments.map(apt => (
            <div key={apt.id} className="p-4 border rounded-xl bg-gray-50 text-base">
              <p className="font-semibold text-lg">{apt.patient.name}</p>
              <p className="text-gray-600">{new Date(apt.date).toLocaleDateString()} 于 {apt.time}</p>
            </div>
          )) : <p>没有未来的预约。</p>)}

          {activeTab === 'history' && (historyAppointments.length > 0 ? historyAppointments.map(apt => (
            <div key={apt.id} className="p-4 border rounded-xl bg-gray-100 text-base">
              <p>{new Date(apt.date).toLocaleDateString()} - {apt.patient.name} <span className={`px-3 py-1 rounded-full text-sm ${statusColors[apt.status]}`}>{statusTranslations[apt.status] || apt.status}</span></p>
            </div>
          )) : <p>没有历史记录。</p>)}
        </div>
      </div>

      {isModalOpen && selectedAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-10 rounded-2xl shadow-2xl w-full max-w-lg">
            <h2 className="text-3xl font-bold mb-6">确认签到并分配床位</h2>
            <form onSubmit={handleConfirmAndAssignBed}>
              <p className="text-lg mb-4">病人: <span className="font-semibold">{selectedAppointment.patient.name}</span></p>
              <p className="text-lg mb-6">时间: {selectedAppointment.time}</p>
              <div>
                <label htmlFor="bedId" className="block text-lg font-medium text-foreground">请输入床位号</label>
                <input id="bedId" type="number" value={assignedBedId} onChange={e => setAssignedBedId(e.target.value)} className="input-base mt-2 text-lg" required />
              </div>
              <div className="flex justify-end gap-4 mt-8">
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn bg-gray-200 text-gray-800 text-lg">取消</button>
                <button type="submit" className="btn btn-primary text-lg">确认分配</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
