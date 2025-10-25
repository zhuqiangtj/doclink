'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface Appointment {
  id: string;
  date: string;
  time: string;
  room: { name: string };
  patient: { name: string };
  status: string;
  bedId: number;
}

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

const isToday = (dateString: string) => new Date(dateString).toDateString() === new Date().toDateString();

export default function DoctorAppointmentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('pending');
  const [bedAssignments, setBedAssignments] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/signin');
    if (status === 'authenticated' && session.user.role !== 'DOCTOR') router.push('/');
  }, [status, session, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      const fetchAppointments = async () => {
        setIsLoading(true);
        try {
          const res = await fetch('/api/appointments');
          if (!res.ok) throw new Error('获取预约列表失败。');
          const data = await res.json();
          setAppointments(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : '发生未知错误');
        } finally {
          setIsLoading(false);
        }
      };
      fetchAppointments();
    }
  }, [status]);

  const checkedInAppointments = appointments.filter(apt => apt.status === 'CHECKED_IN');
  const pendingAppointments = appointments.filter(apt => isToday(apt.date) && apt.status === 'pending');
  const confirmedTodayAppointments = appointments.filter(apt => isToday(apt.date) && apt.status === 'CONFIRMED');
  const historyAppointments = appointments.filter(apt => !isToday(apt.date) || ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(apt.status));

  const handleCancelAppointment = async (appointmentId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/appointments?appointmentId=${appointmentId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('取消预约失败。');
      setAppointments(prev => prev.filter(apt => apt.id !== appointmentId));
    } catch (err) { setError(err instanceof Error ? err.message : '发生未知错误'); }
  };

  const handleCheckinConfirmation = async (appointmentId: string, action: 'CONFIRM' | 'DENY') => {
    setError(null);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/confirm`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!response.ok) throw new Error('操作失败。');
      const updatedAppointment = await response.json();
      setAppointments(prev => prev.map(apt => apt.id === appointmentId ? updatedAppointment : apt));
    } catch (err) { setError(err instanceof Error ? err.message : '发生未知错误'); }
  };

  const handleCompleteAppointment = async (appointmentId: string) => {
    setError(null);
    const bedId = bedAssignments[appointmentId];
    if (!bedId) return setError('请输入床位号。');
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/complete`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bedId: parseInt(bedId) })
      });
      if (!response.ok) throw new Error('完成就诊失败。');
      const updatedAppointment = await response.json();
      setAppointments(prev => prev.map(apt => apt.id === appointmentId ? updatedAppointment : apt));
    } catch (err) { setError(err instanceof Error ? err.message : '发生未知错误'); }
  };

  if (isLoading || status === 'loading') {
    return <div className="container mx-auto p-8 text-center">正在加载...</div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">预约管理</h1>
      {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}

      {/* Checked-in patients awaiting confirmation */}
      {checkedInAppointments.length > 0 && (
        <div className="mb-10 p-8 bg-yellow-100 border-2 border-yellow-400 rounded-2xl shadow-lg">
          <h2 className="text-3xl font-bold mb-6 text-yellow-800">待确认签到 ({checkedInAppointments.length})</h2>
          <div className="space-y-6">
            {checkedInAppointments.map(apt => (
              <div key={apt.id} className="p-5 bg-white rounded-xl shadow-md flex justify-between items-center">
                <div>
                  <p className="font-semibold text-2xl text-gray-800">{apt.patient.name}</p>
                  <p className="text-lg text-gray-600">预约时间: {apt.time}</p>
                </div>
                <div className="flex gap-4">
                  <button onClick={() => handleCheckinConfirmation(apt.id, 'CONFIRM')} className="btn btn-success text-white text-lg">确认接诊</button>
                  <button onClick={() => handleCheckinConfirmation(apt.id, 'DENY')} className="btn bg-gray-300 text-gray-800 text-lg">拒绝</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-8 bg-white rounded-2xl shadow-lg">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button onClick={() => setActiveTab('pending')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'pending' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>待处理</button>
            <button onClick={() => setActiveTab('confirmed')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'confirmed' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>今日已确认</button>
            <button onClick={() => setActiveTab('history')} className={`whitespace-nowrap pb-4 px-1 border-b-4 font-bold text-lg ${activeTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>历史记录</button>
          </nav>
        </div>
        <div className="mt-6 space-y-4 max-h-96 overflow-y-auto">
          {activeTab === 'pending' && pendingAppointments.map(apt => (
            <div key={apt.id} className="p-4 border rounded-xl bg-gray-50 text-base">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-lg">{apt.patient.name}</p>
                  <p className="text-gray-600">{new Date(apt.date).toLocaleDateString()} 于 {apt.time}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm ${statusColors[apt.status] || 'bg-gray-200'}`}>{statusTranslations[apt.status] || apt.status}</span>
              </div>
              <div className="mt-4 pt-4 border-t flex items-center gap-4">
                {apt.status === 'CHECKED_IN' ? (
                  <>
                    <button onClick={() => handleCheckinConfirmation(apt.id, 'CONFIRM')} className="btn btn-primary text-base">确认</button>
                    <button onClick={() => handleCheckinConfirmation(apt.id, 'DENY')} className="btn bg-error text-white text-base">拒绝</button>
                  </>
                ) : apt.status === 'pending' ? (
                  <button onClick={() => handleCancelAppointment(apt.id)} className="btn bg-error text-white text-base">取消预约</button>
                ) : null}
              </div>
            </div>
          ))}
          {activeTab === 'confirmed' && confirmedTodayAppointments.map(apt => (
            <div key={apt.id} className="p-4 border rounded-xl bg-gray-50 text-base">
              <p className="font-semibold text-lg">{apt.patient.name} 于 {apt.time}</p>
              <div className="mt-4 flex gap-4 items-center">
                <input type="number" placeholder="床位号" value={bedAssignments[apt.id] || ''} onChange={e => setBedAssignments({...bedAssignments, [apt.id]: e.target.value})} className="input-base w-28" />
                <button onClick={() => handleCompleteAppointment(apt.id)} className="btn btn-primary text-base">完成</button>
              </div>
            </div>
          ))}
          {activeTab === 'history' && historyAppointments.map(apt => (
            <div key={apt.id} className="p-4 border rounded-xl bg-gray-100 text-base"> 
              <p>{new Date(apt.date).toLocaleDateString()} - {apt.patient.name} <span className={`px-3 py-1 rounded-full text-sm ${statusColors[apt.status]}`}>{statusTranslations[apt.status] || apt.status}</span></p>
              {apt.status === 'COMPLETED' && <p className="text-base text-gray-600">就诊完成，床位号：#{apt.bedId}</p>}
              {apt.status === 'NO_SHOW' && <p className="text-base text-error">爽约。</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
