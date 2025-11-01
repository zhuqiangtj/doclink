'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import './mobile.css';

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
  const [success, ] = useState<string | null>(null);

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

  const handleCancel = async () => {
    // ... (cancellation logic remains the same)
  };

  const getDisplayStatus = (apt: Appointment) => {
    if (apt.status === 'pending' && new Date() > new Date(`${apt.date}T${apt.time}`)) {
      return '已完成';
    }
    return statusTranslations[apt.status] || apt.status;
  };

  if (isLoading || status === 'loading') {
    return <div className="mobile-loading">正在加载预约...</div>;
  }

  return (
    <div className="page-container">
      <h1 className="mobile-header">我的预约</h1>
      {error && <div className="mobile-alert mobile-alert-error">{error}</div>}
      {success && <div className="mobile-alert mobile-alert-success">{success}</div>}

      <div className="mobile-appointments-grid">
        {appointments.length > 0 ? appointments.map(apt => (
          <div key={apt.id} className="mobile-appointment-card">
            <div className="mobile-doctor-name">医生 {apt.doctor.name}</div>
            <div className="mobile-appointment-detail">
              <strong>日期：</strong>{new Date(apt.date).toLocaleDateString()}
            </div>
            <div className="mobile-appointment-detail">
              <strong>时间：</strong>{apt.time}
            </div>
            <div className="mobile-appointment-detail">
              <strong>地点：</strong>{apt.room.name}
            </div>
            <div className={`mobile-status ${
              apt.status === 'pending' ? 'mobile-status-pending' :
              apt.status === 'COMPLETED' ? 'mobile-status-completed' :
              apt.status === 'CANCELLED' ? 'mobile-status-cancelled' :
              'mobile-status-no-show'
            }`}>
              状态：{getDisplayStatus(apt)}
            </div>
            {new Date(`${apt.date}T${apt.time}`) > new Date() && apt.status === 'pending' && (
              <button onClick={() => handleCancel(apt.id)} className="mobile-cancel-btn">
                取消预约
              </button>
            )}
          </div>
        )) : (
          <div className="mobile-empty-state">
            <div className="mobile-empty-icon">📅</div>
            <p className="mobile-empty-text">您没有预约。</p>
          </div>
        )}
      </div>
    </div>
  );
}