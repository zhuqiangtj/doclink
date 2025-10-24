'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FaCheckCircle } from 'react-icons/fa';

interface Notification {
  id: string;
  createdAt: string;
  patientName: string;
  message: string;
  type: string;
  isRead: boolean;
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
      const res = await fetch('/api/notifications', {
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
    return <div className="container mx-auto p-8 text-center">正在加载通知...</div>;
  }

  return (
    <div className="container mx-auto p-6 md:p-10">
      <h1 className="text-4xl font-bold mb-8 text-foreground">通知中心</h1>
      {error && <div className="p-4 mb-6 text-lg text-error bg-red-100 rounded-xl">{error}</div>}
      <div className="space-y-6">
        {notifications.length > 0 ? notifications.map(n => (
          <div key={n.id} className={`p-6 rounded-2xl shadow-lg flex justify-between items-center transition-colors ${n.isRead ? 'bg-gray-100' : 'bg-white'}`}>
            <div>
              <p className={`font-semibold text-xl ${n.type === 'APPOINTMENT_CANCELLED' ? 'text-error' : 'text-success'}`}>
                {n.type === 'APPOINTMENT_CANCELLED' ? '预约已取消' : '新预约提醒'}
              </p>
              <p className="text-lg text-gray-800 mt-2">{n.message}</p>
              <p className="text-base text-gray-500 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
            </div>
            {!n.isRead && (
              <button onClick={() => handleMarkAsRead(n.id)} className="btn btn-primary text-lg flex items-center gap-2">
                <FaCheckCircle />
                我知道了
              </button>
            )}
          </div>
        )) : (
          <div className="text-center py-20">
            <p className="text-2xl text-gray-500">没有新的通知。</p>
          </div>
        )}
      </div>
    </div>
  );
}
