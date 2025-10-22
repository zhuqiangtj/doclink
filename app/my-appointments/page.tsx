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
        if (!res.ok) throw new Error('Failed to fetch appointments.');
        const data = await res.json();
        setAppointments(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
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
        throw new Error(errData.error || 'Check-in failed.');
      }
      setSuccess('Successfully checked in! The doctor has been notified.');
      // Update the status locally
      setAppointments(prev => 
        prev.map(apt => apt.id === appointmentId ? { ...apt, status: 'CHECKED_IN' } : apt)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  // --- Render Logic ---
  if (status === 'loading' || isLoading) {
    return <div className="container mx-auto p-8 text-center">正在加载预约...</div>;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8">
      <h1 className="text-3xl font-bold mb-6">我的预约</h1>
      {error && <div className="p-3 mb-4 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
      {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}

      <div className="space-y-4">
        {appointments.length > 0 ? appointments.map(apt => (
          <div key={apt.id} className="bg-white p-4 border rounded-lg shadow-sm flex justify-between items-center">
            <div>
              <p className="font-bold text-lg">医生 {apt.doctor.name}</p>
              <p className="text-gray-700">日期：{new Date(apt.date).toLocaleDateString()}</p>
              <p className="text-gray-600">时间：{apt.time} 在 {apt.room.name}</p>
              <p className="text-sm font-medium uppercase mt-2">状态：<span className={`px-2 py-1 rounded-full text-xs ${statusColors[apt.status] || 'bg-gray-200'}`}>{apt.status.replace('_',' ')}</span></p>
              {apt.status === 'COMPLETED' && apt.bedId > 0 && (
                <p className="text-sm font-semibold text-green-700 mt-1">就诊完成，床位号：#{apt.bedId}</p>
              )}
            </div>
            <div>
              {isToday(apt.date) && apt.status === 'pending' && (
                <button 
                  onClick={() => handleCheckIn(apt.id)}
                  className="py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  签到
                </button>
              )}
               {apt.status === 'CHECKED_IN' && (
                <span className="text-sm text-gray-500">等待医生确认...</span>
              )}
            </div>
          </div>
        )) : (
          <p>您没有预约。</p>
        )}
      </div>
    </div>
  );
}
