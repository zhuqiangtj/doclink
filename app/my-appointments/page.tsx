'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

// --- Interfaces ---
interface Appointment {
  id: string;
  date: string;
  time: string;
  status: string;
  doctor: { name: string };
  room: { name: string };
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

// --- Helper Function ---
const isToday = (dateString: string) => {
  const date = new Date(dateString);
  const today = new Date();
  // Adjust for timezone differences by comparing year, month, and day
  return date.getUTCFullYear() === today.getUTCFullYear() &&
         date.getUTCMonth() === today.getUTCMonth() &&
         date.getUTCDate() === today.getUTCDate();
};



// --- Component ---
export default function MyAppointmentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Effects ---
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
    if (status === 'authenticated' && session.user.role !== 'PATIENT') {
      // Redirect non-patients or show an error
      router.push('/');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const fetchAppointments = async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/appointments');
        if (!res.ok) throw new Error('获取预约失败。');
        const data = await res.json();
        setAppointments(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAppointments();
  }, [status]);

  // --- Handlers ---
  const handleCheckIn = async (appointmentId: string) => {
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/appointments/${appointmentId}/checkin`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '签到失败。');
      }
      setSuccess('签到成功！医生已收到通知。');
      // Update the status locally
      setAppointments(prev => 
        prev.map(apt => apt.id === appointmentId ? { ...apt, status: 'CHECKED_IN' } : apt)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    }
  };

  const handleCancel = async (appointmentId: string) => {
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
        setSuccess('预约已成功取消。');
      } catch (err) {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    }
  };

  // --- Filtering Logic ---
  const upcomingAppointments = appointments.filter(apt => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(apt.status));
  const pastAppointments = appointments.filter(apt => ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(apt.status));

  // --- Render Logic ---
  if (status === 'loading' || isLoading) {
    return <div className="container mx-auto p-8 text-center">正在加载预约...</div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">我的预约</h1>
      {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}
      {success && <div className="p-4 mb-6 text-lg text-white bg-success rounded-xl">{success}</div>}

      {appointments.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl shadow-lg">
          <p className="text-2xl text-gray-500">您还没有任何预约记录。</p>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Upcoming Appointments */}
          <section>
            <h2 className="text-3xl font-bold mb-6">即将到来的预约</h2>
            <div className="space-y-6">
              {upcomingAppointments.length > 0 ? upcomingAppointments.map(apt => (
                <div key={apt.id} className="bg-white p-6 rounded-2xl shadow-lg flex justify-between items-center">
                  <div>
                    <p className="font-bold text-xl">医生 {apt.doctor.name}</p>
                    <p className="text-gray-700 text-lg mt-1">日期：{new Date(apt.date).toLocaleDateString()}</p>
                    <p className="text-gray-600 text-lg">时间：{apt.time} 在 {apt.room.name}</p>
                    <p className="text-base font-medium uppercase mt-4">状态：<span className={`px-3 py-1 rounded-full text-sm ${statusColors[apt.status] || 'bg-gray-200'}`}>{statusTranslations[apt.status] || apt.status}</span></p>
                  </div>
                  <div className="flex flex-col items-center space-y-4">
                    {isToday(apt.date) && apt.status === 'pending' && (
                      <button 
                        onClick={() => handleCheckIn(apt.id)}
                        className="btn btn-primary text-lg w-32"
                      >
                        签到
                      </button>
                    )}
                    {apt.status === 'CHECKED_IN' && (
                      <span className="text-lg text-gray-500">等待医生确认...</span>
                    )}
                    {new Date(apt.date) > new Date() && (apt.status === 'pending' || apt.status === 'CONFIRMED') && (
                      <button 
                        onClick={() => handleCancel(apt.id)}
                        className="btn bg-error text-white text-lg w-32"
                      >
                        取消预约
                      </button>
                    )}
                  </div>
                </div>
              )) : <p className="text-lg text-gray-500">没有即将到来的预约。</p>}
            </div>
          </section>

          {/* Past Appointments */}
          <section>
            <h2 className="text-3xl font-bold mb-6">历史预约</h2>
            <div className="space-y-6">
              {pastAppointments.length > 0 ? pastAppointments.map(apt => (
                <div key={apt.id} className="bg-gray-100 p-6 rounded-2xl shadow-md flex justify-between items-center opacity-80">
                  <div>
                    <p className="font-bold text-xl">医生 {apt.doctor.name}</p>
                    <p className="text-gray-700 text-lg mt-1">日期：{new Date(apt.date).toLocaleDateString()}</p>
                    <p className="text-gray-600 text-lg">时间：{apt.time} 在 {apt.room.name}</p>
                    <p className="text-base font-medium uppercase mt-4">状态：<span className={`px-3 py-1 rounded-full text-sm ${statusColors[apt.status] || 'bg-gray-200'}`}>{statusTranslations[apt.status] || apt.status}</span></p>
                    {apt.status === 'COMPLETED' && apt.bedId > 0 && (
                      <p className="text-base font-semibold text-success mt-2">就诊完成，床位号：#{apt.bedId}</p>
                    )}
                  </div>
                </div>
              )) : <p className="text-lg text-gray-500">没有历史预约记录。</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
