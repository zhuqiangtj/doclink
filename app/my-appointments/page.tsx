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
}

const statusTranslations: { [key: string]: string } = {
  pending: '待就诊',
  COMPLETED: '已完成',
  NO_SHOW: '已爽约',
  CANCELLED: '已取消',
};

// --- Component ---
export default function MyAppointmentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated' && session.user.role !== 'PATIENT') {
      router.push('/');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status === 'authenticated') {
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
    }
  }, [status]);

  const handleCancel = async (appointmentId: string) => {
    // ... (cancellation logic remains the same)
  };

  const getDisplayStatus = (apt: Appointment) => {
    if (apt.status === 'pending' && new Date() > new Date(`${apt.date}T${apt.time}`)) {
      return '已完成';
    }
    return statusTranslations[apt.status] || apt.status;
  };

  if (isLoading || status === 'loading') {
    return <div className="container mx-auto p-8 text-center">正在加载预约...</div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">我的预约</h1>
      {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}
      {success && <div className="p-4 mb-6 text-lg text-white bg-success rounded-xl">{success}</div>}

      <div className="space-y-6">
        {appointments.length > 0 ? appointments.map(apt => (
          <div key={apt.id} className="bg-white p-6 rounded-2xl shadow-lg">
            <p className="font-bold text-xl">医生 {apt.doctor.name}</p>
            <p className="text-gray-700 text-lg mt-1">日期：{new Date(apt.date).toLocaleDateString()}</p>
            <p className="text-gray-600 text-lg">时间：{apt.time} 在 {apt.room.name}</p>
            <p className="text-base font-medium uppercase mt-4">状态：{getDisplayStatus(apt)}</p>
            {new Date(`${apt.date}T${apt.time}`) > new Date() && apt.status === 'pending' && (
              <button onClick={() => handleCancel(apt.id)} className="btn bg-error text-white text-lg mt-4">取消预约</button>
            )}
          </div>
        )) : (
          <div className="text-center py-20"><p className="text-2xl text-gray-500">您没有预约。</p></div>
        )}
      </div>
    </div>
  );
}