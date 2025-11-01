'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FaCheckCircle } from 'react-icons/fa';
import './mobile.css';

interface Notification {
  id: string;
  createdAt: string;
  patientName: string;
  message: string;
  type: string;
  isRead: boolean;
  appointment?: {
    time: string;
    schedule: {
      date: string;
    };
    room: {
      name: string;
    };
  };
}

export default function DoctorNotificationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated' && session.user.role !== 'DOCTOR') {
      router.push('/');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      const fetchNotifications = async () => {
        setIsLoading(true);
        try {
          const res = await fetch('/api/notifications');
          if (!res.ok) throw new Error('Failed to fetch notifications.');
          const data = await res.json();
          setNotifications(data.notifications || []);
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
      const res = await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: [notificationId] }),
      });
      if (!res.ok) throw new Error('Failed to mark as read.');
      
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, isRead: true } : n)
      );
      
      // 觸發底部導航欄的未讀計數更新
      window.dispatchEvent(new CustomEvent('notificationRead'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    }
  };

  if (isLoading || status === 'loading') {
    return <div className="mobile-loading">正在加载通知...</div>;
  }

  return (
    <div className="mobile-container">
      <h1 className="mobile-header">通知中心</h1>
      {error && <div className="mobile-error">{error}</div>}
      <div className="mobile-notifications-list">
        {notifications.length > 0 ? notifications.map(n => (
          <div key={n.id} className={`mobile-notification-card ${n.isRead ? 'mobile-notification-read' : 'mobile-notification-unread'}`}>
            <div className="mobile-notification-content">
              <p className={`mobile-notification-type ${n.type === 'APPOINTMENT_CANCELLED' ? 'mobile-notification-cancelled' : 'mobile-notification-appointment'}`}>
                {n.type === 'APPOINTMENT_CANCELLED' ? '預約已取消' : 
                 n.type === 'APPOINTMENT_CREATED' ? '新預約提醒' : '預約通知'}
              </p>
              <div className="mobile-notification-details">
                <p className="mobile-notification-patient">
                  <strong>病人：</strong>{n.patientName}
                </p>
                {n.appointment && (
                  <>
                    <p className="mobile-notification-datetime">
                      <strong>日期：</strong>{new Date(n.appointment.schedule.date).toLocaleDateString('zh-CN')}
                    </p>
                    <p className="mobile-notification-datetime">
                      <strong>時間：</strong>{n.appointment.time}
                    </p>
                    <p className="mobile-notification-room">
                      <strong>診室：</strong>{n.appointment.room.name}
                    </p>
                  </>
                )}
              </div>
              <p className="mobile-notification-message">{n.message}</p>
              <p className="mobile-notification-date">{new Date(n.createdAt).toLocaleString('zh-CN')}</p>
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
            <p className="mobile-empty-text">沒有新的通知。</p>
          </div>
        )}
      </div>
    </div>
  );
}
