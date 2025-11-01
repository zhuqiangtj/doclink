'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FaCheckCircle } from 'react-icons/fa';
import './mobile.css';

interface PatientNotification {
  id: string;
  createdAt: string;
  doctorName: string;
  message: string;
  type: string;
  isRead: boolean;
}

export default function PatientNotificationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [notifications, setNotifications] = useState<PatientNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated' && session.user.role !== 'PATIENT') {
      router.push('/');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      const fetchNotifications = async () => {
        setIsLoading(true);
        try {
          const res = await fetch('/api/patient-notifications');
          if (!res.ok) throw new Error('Failed to fetch notifications.');
          const data = await res.json();
          setNotifications(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'An unknown error occurred');
        } finally {
          setIsLoading(false);
        }
      };
      fetchNotifications();
    }
  }, [status]);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const res = await fetch('/api/patient-notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [notificationId] }),
      });
      if (!res.ok) throw new Error('Failed to mark as read.');
      
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, isRead: true } : n)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  if (isLoading || status === 'loading') {
    return <div className="mobile-loading">正在加载通知...</div>;
  }

  return (
    <div className="page-container">
      <h1 className="mobile-header">我的通知</h1>
      {error && <div className="mobile-alert">{error}</div>}
      <div className="mobile-notifications-grid">
        {notifications.length > 0 ? notifications.map(n => (
          <div key={n.id} className={`mobile-notification-card ${n.isRead ? 'mobile-notification-card-read' : 'mobile-notification-card-unread'}`}>
            <div className="mobile-notification-content">
              <div className={`mobile-notification-title ${n.type === 'APPOINTMENT_CANCELLED_BY_DOCTOR' ? 'mobile-notification-title-cancelled' : 'mobile-notification-title-appointment'}`}>
                {n.type === 'APPOINTMENT_CANCELLED_BY_DOCTOR' ? '预约被取消' : '新预约通知'}
              </div>
              <div className="mobile-notification-message">{n.message}</div>
              <div className="mobile-notification-date">{new Date(n.createdAt).toLocaleString()}</div>
            </div>
            {!n.isRead && (
              <button onClick={() => handleMarkAsRead(n.id)} className="mobile-mark-read-btn">
                <FaCheckCircle className="mobile-mark-read-icon" />
                我知道了
              </button>
            )}
          </div>
        )) : (
          <div className="mobile-empty-state">
            <div className="mobile-empty-icon">🔔</div>
            <p className="mobile-empty-text">没有新的通知。</p>
          </div>
        )}
      </div>
    </div>
  );
}
